"""One-process controller for live and step-by-step ingestion lab runs."""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from threading import Event, Lock, Thread
from uuid import UUID, uuid4

from psycopg.types.json import Jsonb

from rag.documents import DocumentValidationError, POLICY_DIR
from rag.ingestion import (
    IngestionBusyError,
    IngestionMilestone,
    ingest_policy,
)


class LabRunError(RuntimeError):
    """A safe local run-control error for the browser API."""


class LabRunStopped(RuntimeError):
    """The user or server stopped a run at a stage boundary."""


@dataclass
class LabRun:
    run_id: UUID
    source_path: str
    mode: str
    status: str = "STARTING"
    job_id: UUID | None = None
    wait_sequence: int | None = None
    current_sequence: int | None = None
    current_state: str | None = None
    detail: str = "Preparing the selected source."
    error_category: str | None = None
    error_message: str | None = None
    already_ready: bool = False
    continue_event: Event = field(default_factory=Event)
    stop_event: Event = field(default_factory=Event)
    lock: Lock = field(default_factory=Lock)
    thread: Thread | None = None

    def as_dict(self) -> dict:
        with self.lock:
            return {
                "run_id": str(self.run_id),
                "source_path": self.source_path,
                "mode": self.mode,
                "status": self.status,
                "job_id": str(self.job_id) if self.job_id else None,
                "wait_sequence": self.wait_sequence,
                "current_sequence": self.current_sequence,
                "current_state": self.current_state,
                "detail": self.detail,
                "error_category": self.error_category,
                "error_message": self.error_message,
                "already_ready": self.already_ready,
            }


class IngestionLabController:
    """Run at most one lab ingestion in this local server process."""

    ACTIVE = {"STARTING", "RUNNING", "PAUSED", "STOPPING"}
    TERMINAL = {"READY", "FAILED", "ALREADY_READY"}
    MAX_RETAINED_RUNS = 32

    def __init__(self) -> None:
        self._runs: dict[UUID, LabRun] = {}
        self._lock = Lock()
        self._shutting_down = Event()

    def start(self, relative_source: str, mode: str) -> LabRun:
        if mode not in {"LIVE", "STEP"}:
            raise LabRunError("Select Live or Step mode.")
        source = self._resolve_source(relative_source)
        with self._lock:
            if any(run.status in self.ACTIVE for run in self._runs.values()):
                raise LabRunError("Another ingestion lab run is active.")
            self._shutting_down.clear()
            self._prune_runs()
            run = LabRun(uuid4(), source.relative_to(POLICY_DIR).as_posix(), mode)
            worker = Thread(
                target=self._run_ingestion,
                args=(run, source),
                name=f"ingestion-lab-{run.run_id.hex[:8]}",
                daemon=True,
            )
            run.thread = worker
            self._runs[run.run_id] = run
            worker.start()
            return run

    def get(self, run_id: UUID) -> LabRun:
        with self._lock:
            run = self._runs.get(run_id)
        if not run:
            raise LabRunError("This run is no longer available in this server session.")
        return run

    def continue_run(self, run_id: UUID, expected_sequence: int) -> LabRun:
        run = self.get(run_id)
        with run.lock:
            if run.status != "PAUSED" or run.wait_sequence != expected_sequence:
                raise LabRunError("This run has moved. Refresh its current stage before continuing.")
            run.wait_sequence = None
            run.status = "RUNNING"
            run.detail = "Continuing to the next stage."
            run.continue_event.set()
        return run

    def stop(self, run_id: UUID) -> LabRun:
        run = self.get(run_id)
        with run.lock:
            if run.status not in self.ACTIVE:
                raise LabRunError("This run has already finished.")
            run.status = "STOPPING"
            run.detail = "Stop requested. The worker will stop at the next stage boundary."
            run.stop_event.set()
            run.continue_event.set()
        return run

    def shutdown(self) -> None:
        self._shutting_down.set()
        with self._lock:
            runs = list(self._runs.values())
        for run in runs:
            if run.status in self.ACTIVE:
                run.stop_event.set()
                run.continue_event.set()
        for run in runs:
            if run.thread and run.thread.is_alive():
                run.thread.join(timeout=5)

    def recover_stale_jobs(self) -> None:
        """Mark only prior lab runs as interrupted after an unclean stop."""
        from rag.database import connect_project_database

        with connect_project_database() as conn:
            with conn.transaction():
                stale = conn.execute(
                    "SELECT job_id, document_id, version, status "
                    "FROM ingestion_jobs WHERE run_mode IN ('LIVE', 'STEP') "
                    "AND status NOT IN ('READY', 'FAILED') FOR UPDATE"
                ).fetchall()
                for job_id, document_id, version, status in stale:
                    detail = "The lab server stopped before this run finished. Start a new attempt to retry."
                    conn.execute(
                        "UPDATE ingestion_jobs SET status = 'FAILED', completed_at = now(), error_message = %s "
                        "WHERE job_id = %s",
                        (detail, job_id),
                    )
                    conn.execute(
                        "UPDATE document_versions SET status = 'FAILED' "
                        "WHERE document_id = %s AND version = %s AND status <> 'READY'",
                        (document_id, version),
                    )
                    sequence = conn.execute(
                        "SELECT COALESCE(MAX(sequence), 0) + 1 FROM ingestion_job_events WHERE job_id = %s",
                        (job_id,),
                    ).fetchone()[0]
                    conn.execute(
                        "INSERT INTO ingestion_job_events "
                        "(job_id, sequence, status, detail, payload) "
                        "VALUES (%s, %s, 'FAILED', %s, %s)",
                        (
                            job_id,
                            sequence,
                            detail,
                            Jsonb({"category": "LabServerStopped", "last_state": status}),
                        ),
                    )

    @staticmethod
    def _resolve_source(relative_source: str) -> Path:
        candidate = (POLICY_DIR / relative_source).resolve()
        if candidate.parent != POLICY_DIR.resolve() or candidate.suffix.lower() != ".md":
            raise LabRunError("Choose a Markdown file from the policy source list.")
        if not candidate.is_file():
            raise LabRunError("The selected policy source is not available.")
        if candidate.stat().st_size > 65_536:
            raise LabRunError("The ingestion lab supports policy files up to 64 KiB.")
        return candidate

    def _run_ingestion(self, run: LabRun, source: Path) -> None:
        with run.lock:
            run.status = "RUNNING"
            run.detail = "Reading and validating the policy source."
        try:
            result = ingest_policy(
                source,
                run_mode=run.mode,
                on_milestone=lambda milestone: self._on_milestone(run, milestone),
            )
            with run.lock:
                if result.already_ready:
                    run.status = "ALREADY_READY"
                    run.already_ready = True
                    run.detail = (
                        f"{result.document_id} v{result.version} is already ready. "
                        "No new ingestion job was created."
                    )
                else:
                    run.status = "READY"
                    run.detail = f"{result.document_id} v{result.version} is ready and active."
        except Exception as exc:
            with run.lock:
                run.status = "FAILED"
                run.error_category = type(exc).__name__
                run.error_message = self._safe_error(exc)
                if self._shutting_down.is_set():
                    run.detail = "The lab server stopped this unfinished run. Start a new attempt to retry."
                elif isinstance(exc, LabRunStopped):
                    run.detail = "The run stopped at the requested stage boundary."
                else:
                    run.detail = run.error_message

    def _on_milestone(self, run: LabRun, milestone: IngestionMilestone) -> None:
        with run.lock:
            run.job_id = milestone.job_id
            run.current_sequence = milestone.sequence
            run.current_state = milestone.state
            run.detail = milestone.detail
            if milestone.state == "READY":
                run.status = "READY"
                run.wait_sequence = None
                return
            if self._shutting_down.is_set() or run.stop_event.is_set():
                raise LabRunStopped("Run stopped at a saved stage boundary.")
            if run.mode != "STEP" or milestone.state == "PENDING":
                run.status = "RUNNING"
                return
            run.continue_event.clear()
            run.wait_sequence = milestone.sequence
            run.status = "PAUSED"
            run.detail = f"{milestone.state.title()} is complete. Continue when you are ready."

        while not run.continue_event.wait(timeout=0.2):
            if self._shutting_down.is_set() or run.stop_event.is_set():
                raise LabRunStopped("Run stopped at a saved stage boundary.")

        if self._shutting_down.is_set() or run.stop_event.is_set():
            raise LabRunStopped("Run stopped at a saved stage boundary.")

    @staticmethod
    def _safe_error(exc: Exception) -> str:
        if isinstance(exc, (DocumentValidationError, IngestionBusyError, LabRunError, ValueError)):
            return str(exc)
        return f"The ingestion run failed ({type(exc).__name__}). Inspect its saved job events."

    def _prune_runs(self) -> None:
        terminal = [run_id for run_id, run in self._runs.items() if run.status in self.TERMINAL]
        while len(self._runs) >= self.MAX_RETAINED_RUNS and terminal:
            self._runs.pop(terminal.pop(0), None)


controller = IngestionLabController()
