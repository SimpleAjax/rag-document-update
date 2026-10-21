"""Local-only HTTP API for the RAG ingestion teaching page."""

from __future__ import annotations

from contextlib import asynccontextmanager
from pathlib import Path
from typing import Literal
from uuid import UUID

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from rag.database import connect_project_database
from rag.documents import DocumentValidationError, POLICY_DIR, load_policy
from rag.lab_controller import LabRunError, controller
from rag.search import retrieve_detailed


WEB_DIR = Path(__file__).resolve().parent / "lab_web"


class StartRunRequest(BaseModel):
    source_path: str = Field(min_length=1, max_length=255)
    mode: Literal["LIVE", "STEP"]


class ContinueRunRequest(BaseModel):
    expected_sequence: int = Field(ge=1)


class SearchQuestionRequest(BaseModel):
    question: str = Field(min_length=1, max_length=1000)
    top_k: int = Field(default=5, ge=1, le=5)


@asynccontextmanager
async def lifespan(_: FastAPI):
    controller.recover_stale_jobs()
    yield
    controller.shutdown()


app = FastAPI(
    title="Cimulink RAG Ingestion Lab",
    docs_url=None,
    redoc_url=None,
    lifespan=lifespan,
)
app.mount("/static", StaticFiles(directory=WEB_DIR), name="static")


@app.get("/", include_in_schema=False)
def home() -> FileResponse:
    return FileResponse(WEB_DIR / "index.html")


@app.get("/api/sources")
def list_sources() -> dict:
    versions: dict[tuple[str, int], dict] = {}
    active: dict[str, int] = {}
    with connect_project_database() as conn:
        for document_id, version, digest, status in conn.execute(
            "SELECT document_id, version, source_sha256, status FROM document_versions"
        ).fetchall():
            versions[(document_id, version)] = {
                "source_sha256": digest.strip(),
                "status": status,
            }
        active = dict(
            conn.execute(
                "SELECT document_id, version FROM active_document_versions"
            ).fetchall()
        )

    sources = []
    for source in sorted(POLICY_DIR.glob("*.md")):
        relative_path = source.relative_to(POLICY_DIR).as_posix()
        try:
            document = load_policy(source)
            known = versions.get((document.document_id, document.version))
            sources.append(
                {
                    "source_path": relative_path,
                    "document_id": document.document_id,
                    "version": document.version,
                    "title": document.title,
                    "source_sha256": document.source_sha256,
                    "source_bytes": len(document.source_text.encode("utf-8")),
                    "database_status": known["status"] if known else None,
                    "source_matches_database": bool(
                        known and known["source_sha256"] == document.source_sha256
                    ),
                    "active": active.get(document.document_id) == document.version,
                    "valid": True,
                }
            )
        except (DocumentValidationError, OSError) as exc:
            sources.append(
                {
                    "source_path": relative_path,
                    "valid": False,
                    "error": str(exc),
                }
            )
    return {"sources": sources}


@app.post("/api/search")
def search_question(request: SearchQuestionRequest) -> dict:
    """Search the current active corpus through the shared agent retrieval path."""
    try:
        return retrieve_detailed(request.question, request.top_k)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(503, str(exc)) from exc


@app.post("/api/runs", status_code=202)
def start_run(request: StartRunRequest) -> dict:
    try:
        run = controller.start(request.source_path, request.mode)
    except LabRunError as exc:
        message = str(exc)
        status_code = 409 if "active" in message or "already running" in message else 422
        raise HTTPException(status_code, message) from exc
    return run.as_dict()


@app.get("/api/runs/{run_id}")
def get_run(run_id: UUID) -> dict:
    try:
        return controller.get(run_id).as_dict()
    except LabRunError as exc:
        raise HTTPException(404, str(exc)) from exc


@app.post("/api/runs/{run_id}/continue")
def continue_run(run_id: UUID, request: ContinueRunRequest) -> dict:
    try:
        run = controller.continue_run(run_id, request.expected_sequence)
        return run.as_dict()
    except LabRunError as exc:
        raise HTTPException(409, str(exc)) from exc


@app.post("/api/runs/{run_id}/stop")
def stop_run(run_id: UUID) -> dict:
    try:
        run = controller.stop(run_id)
        return run.as_dict()
    except LabRunError as exc:
        raise HTTPException(409, str(exc)) from exc


@app.get("/api/jobs")
def list_jobs() -> dict:
    with connect_project_database() as conn:
        rows = conn.execute(
            "SELECT job_id, document_id, version, run_mode, status, error_message, created_at, completed_at "
            "FROM ingestion_jobs WHERE run_mode IN ('LIVE', 'STEP') "
            "ORDER BY created_at DESC LIMIT 30"
        ).fetchall()
    return {
        "jobs": [
            {
                "job_id": str(row[0]),
                "document_id": row[1],
                "version": row[2],
                "mode": row[3],
                "status": row[4],
                "error_message": row[5],
                "created_at": row[6].isoformat() if row[6] else None,
                "completed_at": row[7].isoformat() if row[7] else None,
            }
            for row in rows
        ]
    }


@app.get("/api/jobs/{job_id}")
def get_job(job_id: UUID) -> dict:
    with connect_project_database() as conn:
        row = conn.execute(
            "SELECT job_id, document_id, version, run_mode, status, error_message, created_at, completed_at "
            "FROM ingestion_jobs WHERE job_id = %s AND run_mode IN ('LIVE', 'STEP')",
            (job_id,),
        ).fetchone()
        if not row:
            raise HTTPException(404, "Lab job was not found.")
        events = conn.execute(
            "SELECT sequence, status, detail, occurred_at, payload "
            "FROM ingestion_job_events WHERE job_id = %s ORDER BY sequence",
            (job_id,),
        ).fetchall()
    return {
        "job": {
            "job_id": str(row[0]),
            "document_id": row[1],
            "version": row[2],
            "mode": row[3],
            "status": row[4],
            "error_message": row[5],
            "created_at": row[6].isoformat() if row[6] else None,
            "completed_at": row[7].isoformat() if row[7] else None,
        },
        "events": [
            {
                "sequence": sequence,
                "state": state,
                "detail": detail,
                "occurred_at": occurred_at.isoformat(),
                "payload": payload or {},
            }
            for sequence, state, detail, occurred_at, payload in events
        ],
    }
