"""Synchronous, version-aware ingestion with saved stage artifacts."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from time import perf_counter
from typing import Callable
from uuid import UUID, uuid4

import numpy as np
import psycopg
from psycopg.types.json import Jsonb

from rag.database import connect_project_database
from rag.documents import (
    PassageDetails,
    PolicyDocument,
    load_policy,
    split_passages_detailed,
)
from rag.embeddings import DIMENSIONS, MODEL_NAME, embed_texts


STATES = ("PENDING", "VALIDATING", "CHUNKING", "EMBEDDING", "INDEXING", "READY")
RUN_MODES = {"CLI", "LIVE", "STEP"}


class IngestionBusyError(RuntimeError):
    """Another ingestion job already holds the lock for this document."""


@dataclass(frozen=True)
class IngestionMilestone:
    job_id: UUID
    sequence: int
    state: str
    detail: str
    payload: dict


@dataclass(frozen=True)
class IngestionResult:
    job_id: UUID | None
    document_id: str
    version: int
    status: str
    passage_count: int
    already_ready: bool = False


def _event(
    conn: psycopg.Connection,
    job_id: UUID,
    document_id: str,
    version: int,
    status: str,
    detail: str,
    payload: dict,
) -> int:
    with conn.transaction():
        conn.execute(
            "UPDATE document_versions SET status = %s WHERE document_id = %s AND version = %s",
            (status, document_id, version),
        )
        conn.execute(
            "UPDATE ingestion_jobs SET status = %s WHERE job_id = %s",
            (status, job_id),
        )
        sequence = conn.execute(
            "SELECT COALESCE(MAX(sequence), 0) + 1 FROM ingestion_job_events WHERE job_id = %s",
            (job_id,),
        ).fetchone()[0]
        conn.execute(
            "INSERT INTO ingestion_job_events (job_id, sequence, status, detail, payload) "
            "VALUES (%s, %s, %s, %s, %s)",
            (job_id, sequence, status, detail, Jsonb(payload)),
        )
    return sequence


def _try_document_lock(conn: psycopg.Connection, document_id: str) -> bool:
    acquired = conn.execute(
        "SELECT pg_try_advisory_lock(hashtextextended(%s, 0))", (document_id,)
    ).fetchone()[0]
    conn.rollback()
    return acquired


def _release_document_lock(conn: psycopg.Connection, document_id: str) -> None:
    conn.execute("SELECT pg_advisory_unlock(hashtextextended(%s, 0))", (document_id,))
    conn.rollback()


def _start_job(
    conn: psycopg.Connection, document: PolicyDocument, run_mode: str
) -> tuple[UUID | None, bool]:
    job_id = uuid4()
    with conn.transaction():
        conn.execute(
            "INSERT INTO policy_documents (document_id, title) VALUES (%s, %s) "
            "ON CONFLICT (document_id) DO UPDATE SET title = EXCLUDED.title",
            (document.document_id, document.title),
        )
        existing = conn.execute(
            "SELECT source_sha256, status FROM document_versions WHERE document_id = %s AND version = %s",
            (document.document_id, document.version),
        ).fetchone()
        if existing:
            existing_hash, existing_status = existing
            if existing_hash.strip() != document.source_sha256:
                raise ValueError(
                    "This document version already exists with different source content. Create a new version."
                )
            if existing_status == "READY":
                return None, True
        active = conn.execute(
            "SELECT version FROM active_document_versions WHERE document_id = %s",
            (document.document_id,),
        ).fetchone()
        if active and document.version <= active[0]:
            raise ValueError("A new policy version must be greater than the active version.")

        if existing:
            conn.execute(
                "UPDATE ingestion_jobs SET status = 'FAILED', completed_at = now(), "
                "error_message = 'Superseded by a retry' "
                "WHERE document_id = %s AND version = %s AND status NOT IN ('READY', 'FAILED')",
                (document.document_id, document.version),
            )
            conn.execute(
                "UPDATE document_versions SET status = 'PENDING' WHERE document_id = %s AND version = %s",
                (document.document_id, document.version),
            )
        else:
            conn.execute(
                "INSERT INTO document_versions (document_id, version, source_path, source_sha256, status) "
                "VALUES (%s, %s, %s, %s, 'PENDING')",
                (document.document_id, document.version, document.source_path, document.source_sha256),
            )
        conn.execute(
            "INSERT INTO ingestion_jobs (job_id, document_id, version, status, run_mode) "
            "VALUES (%s, %s, %s, 'PENDING', %s)",
            (job_id, document.document_id, document.version, run_mode),
        )
        conn.execute(
            "INSERT INTO ingestion_job_events (job_id, sequence, status, detail, payload) "
            "VALUES (%s, 1, 'PENDING', %s, %s)",
            (
                job_id,
                "Ingestion job created.",
                Jsonb(
                    {
                        "document_id": document.document_id,
                        "version": document.version,
                        "run_mode": run_mode,
                    }
                ),
            ),
        )
    return job_id, False


def _mark_failed(
    conn: psycopg.Connection,
    job_id: UUID,
    document: PolicyDocument,
    error: Exception,
    last_state: str,
) -> None:
    detail = "Ingestion failed. Inspect the local command output for details."
    with conn.transaction():
        conn.execute(
            "UPDATE document_versions SET status = 'FAILED' WHERE document_id = %s AND version = %s AND status <> 'READY'",
            (document.document_id, document.version),
        )
        conn.execute(
            "UPDATE ingestion_jobs SET status = 'FAILED', completed_at = now(), error_message = %s WHERE job_id = %s",
            (detail, job_id),
        )
        sequence = conn.execute(
            "SELECT COALESCE(MAX(sequence), 0) + 1 FROM ingestion_job_events WHERE job_id = %s",
            (job_id,),
        ).fetchone()[0]
        conn.execute(
            "INSERT INTO ingestion_job_events (job_id, sequence, status, detail, payload) "
            "VALUES (%s, %s, 'FAILED', %s, %s)",
            (
                job_id,
                sequence,
                detail,
                Jsonb({"category": type(error).__name__, "last_state": last_state}),
            ),
        )


def _passage_payload(index: int, passage: PassageDetails) -> dict:
    return {
        "passage_index": index,
        "passage_id_suffix": f"p{index + 1}",
        "text": passage.text,
        "character_count": len(passage.text),
        "paragraph_indexes": list(passage.paragraph_indexes),
        "start_offset": passage.start_offset,
        "end_offset": passage.end_offset,
        "overlap_with_previous": passage.overlap_with_previous,
    }


def ingest_policy(
    path: str | Path,
    *,
    embedding_fn: Callable[[list[str]], list[list[float]]] = embed_texts,
    on_state: Callable[[str, str], None] | None = None,
    on_milestone: Callable[[IngestionMilestone], None] | None = None,
    run_mode: str = "CLI",
) -> IngestionResult:
    """Ingest one version and publish committed stage details to optional hooks."""
    if run_mode not in RUN_MODES:
        raise ValueError("run_mode must be CLI, LIVE, or STEP.")
    document = load_policy(path)
    conn = connect_project_database()
    job_id: UUID | None = None
    lock_acquired = False
    current_state = "PENDING"
    committed_ready = False
    try:
        lock_acquired = _try_document_lock(conn, document.document_id)
        if not lock_acquired:
            raise IngestionBusyError(
                f"Another ingestion job is already running for {document.document_id}."
            )
        job_id, already_ready = _start_job(conn, document, run_mode)
        if already_ready:
            return IngestionResult(None, document.document_id, document.version, "READY", 0, True)
        assert job_id is not None
        if on_milestone:
            on_milestone(
                IngestionMilestone(
                    job_id,
                    1,
                    "PENDING",
                    "Ingestion job created.",
                    {
                        "document_id": document.document_id,
                        "version": document.version,
                        "run_mode": run_mode,
                    },
                )
            )

        def advance(state: str, detail: str, payload: dict) -> None:
            nonlocal current_state
            current_state = state
            sequence = _event(
                conn,
                job_id,
                document.document_id,
                document.version,
                state,
                detail,
                payload if run_mode != "CLI" else {},
            )
            if on_state:
                on_state(state, detail)
            if on_milestone:
                on_milestone(
                    IngestionMilestone(job_id, sequence, state, detail, payload)
                )

        validation_started = perf_counter()
        advance(
            "VALIDATING",
            "Metadata and source hash validated.",
            {
                "document_id": document.document_id,
                "version": document.version,
                "title": document.title,
                "source_path": document.source_path,
                "source_sha256": document.source_sha256,
                "source_bytes": len(document.source_text.encode("utf-8")),
                "source_text": document.source_text,
                "duration_ms": round((perf_counter() - validation_started) * 1000, 2),
            },
        )

        chunk_started = perf_counter()
        passages = split_passages_detailed(document.body)
        if not passages:
            raise ValueError("Policy source contains no ingestible text.")
        if run_mode != "CLI" and len(passages) > 32:
            raise ValueError("The ingestion lab supports up to 32 passages per run.")
        planned_ids = [
            f"{document.document_id}-v{document.version}-p{index + 1}"
            for index in range(len(passages))
        ]
        passage_artifacts = [
            _passage_payload(index, passage) for index, passage in enumerate(passages)
        ]
        passage_artifacts = [
            {**artifact, "passage_id": passage_id}
            for artifact, passage_id in zip(passage_artifacts, planned_ids, strict=True)
        ]
        advance(
            "CHUNKING",
            f"Created {len(passages)} deterministic passage(s).",
            {
                "max_chars": 650,
                "overlap_chars": 80,
                "duration_ms": round((perf_counter() - chunk_started) * 1000, 2),
                "passages": passage_artifacts,
            },
        )

        embedding_started = perf_counter()
        vectors = embedding_fn([passage.text for passage in passages])
        if len(vectors) != len(passages) or any(
            np.asarray(vector).shape != (DIMENSIONS,)
            or not np.isfinite(np.asarray(vector)).all()
            for vector in vectors
        ):
            raise ValueError("Embedding model returned invalid vectors.")
        embedding_duration = round((perf_counter() - embedding_started) * 1000, 2)
        if run_mode != "CLI":
            passage_artifacts = [
                {
                    **artifact,
                    "embedding": np.asarray(vector, dtype=np.float32).astype(float).tolist(),
                }
                for artifact, vector in zip(passage_artifacts, vectors, strict=True)
            ]
        advance(
            "EMBEDDING",
            f"Generated {len(vectors)} local embedding(s).",
            {
                "model_name": MODEL_NAME,
                "dimensions": DIMENSIONS,
                "duration_ms": embedding_duration,
                "passages": passage_artifacts,
            },
        )

        old_active_row = conn.execute(
            "SELECT version FROM active_document_versions WHERE document_id = %s",
            (document.document_id,),
        ).fetchone()
        old_active_version = old_active_row[0] if old_active_row else None
        conn.rollback()
        advance(
            "INDEXING",
            "Writing passages and activating the complete version.",
            {
                "planned_passage_ids": planned_ids,
                "passage_count": len(passages),
                "previous_active_version": old_active_version,
            },
        )

        with conn.transaction():
            for index, (passage, vector) in enumerate(zip(passages, vectors, strict=True)):
                conn.execute(
                    "INSERT INTO policy_passages "
                    "(passage_id, document_id, version, passage_index, content, embedding) "
                    "VALUES (%s, %s, %s, %s, %s, %s)",
                    (
                        planned_ids[index],
                        document.document_id,
                        document.version,
                        index,
                        passage.text,
                        vector,
                    ),
                )
            conn.execute(
                "UPDATE document_versions SET status = 'READY', ready_at = now() WHERE document_id = %s AND version = %s",
                (document.document_id, document.version),
            )
            conn.execute(
                "INSERT INTO active_document_versions (document_id, version) VALUES (%s, %s) "
                "ON CONFLICT (document_id) DO UPDATE SET version = EXCLUDED.version, activated_at = now()",
                (document.document_id, document.version),
            )
            conn.execute(
                "UPDATE ingestion_jobs SET status = 'READY', completed_at = now() WHERE job_id = %s",
                (job_id,),
            )
            sequence = conn.execute(
                "SELECT COALESCE(MAX(sequence), 0) + 1 FROM ingestion_job_events WHERE job_id = %s",
                (job_id,),
            ).fetchone()[0]
            ready_payload = {
                "passage_ids": planned_ids,
                "passage_count": len(passages),
                "previous_active_version": old_active_version,
                "active_version": document.version,
            }
            conn.execute(
                "INSERT INTO ingestion_job_events (job_id, sequence, status, detail, payload) "
                "VALUES (%s, %s, 'READY', %s, %s)",
                (
                    job_id,
                    sequence,
                    "All passages are ready; version is active.",
                    Jsonb(ready_payload if run_mode != "CLI" else {}),
                ),
            )
        committed_ready = True
        ready_milestone = IngestionMilestone(
            job_id,
            sequence,
            "READY",
            "All passages are ready; version is active.",
            ready_payload,
        )
        if on_state:
            on_state("READY", ready_milestone.detail)
        if on_milestone:
            on_milestone(ready_milestone)
        return IngestionResult(job_id, document.document_id, document.version, "READY", len(passages))
    except Exception as exc:
        if job_id is not None and not committed_ready:
            _mark_failed(conn, job_id, document, exc, current_state)
        raise
    finally:
        if lock_acquired:
            _release_document_lock(conn, document.document_id)
        conn.close()
