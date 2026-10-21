"""Durable, bounded public event trail for local ADK chat runs."""

from __future__ import annotations

import json
import re
import threading
from datetime import datetime
from uuid import UUID, uuid4

from psycopg.types.json import Jsonb

from rag.database import connect_project_database


MAX_FIELD_CHARACTERS = 64_000
_SECRET_ASSIGNMENT = re.compile(
    r"(?i)\b(api[_-]?key|secret(?:[_-]?key)?|password|passwd|authorization|access[_-]?token|refresh[_-]?token)\b\s*[:=]\s*(?:Bearer\s+)?[^\s,;]+"
)
_BEARER = re.compile(r"(?i)\bBearer\s+[A-Za-z0-9._~+/-]+=*")
_OPENAI_STYLE_KEY = re.compile(r"\bsk-[A-Za-z0-9_-]{16,}\b")
_DATABASE_URL = re.compile(r"(?i)\b(?:postgres(?:ql)?|mysql)://[^\s\"']+")


def redact_text(value: str) -> str:
    value = _DATABASE_URL.sub("[REDACTED DATABASE URL]", value)
    value = _SECRET_ASSIGNMENT.sub(lambda match: f"{match.group(1)}=[REDACTED]", value)
    value = _BEARER.sub("Bearer [REDACTED]", value)
    return _OPENAI_STYLE_KEY.sub("[REDACTED KEY]", value)


def _safe_value(value):
    if isinstance(value, str):
        return redact_text(value)
    if isinstance(value, dict):
        safe = {}
        for key, item in value.items():
            key = str(key)
            if re.search(r"(?i)(api.?key|secret|password|token|authorization|credential)", key):
                safe[key] = "[REDACTED]"
            else:
                safe[key] = _safe_value(item)
        return safe
    if isinstance(value, (list, tuple)):
        return [_safe_value(item) for item in value]
    if isinstance(value, (int, float, bool)) or value is None:
        return value
    return redact_text(str(value))


def _bounded_json(value) -> dict | list | str | int | float | bool | None:
    safe = _safe_value(value)
    encoded = json.dumps(safe, ensure_ascii=False, default=str)
    if len(encoded) <= MAX_FIELD_CHARACTERS:
        return safe
    return {
        "truncated": True,
        "original_characters": len(encoded),
        "preview": encoded[: MAX_FIELD_CHARACTERS - 150],
    }


class ChatEventRecorder:
    def __init__(self, run_id: UUID, turn_index: int = 1):
        self.run_id = run_id
        self.turn_index = turn_index
        self._lock = threading.RLock()
        with connect_project_database() as conn:
            self.sequence = conn.execute(
                "SELECT COALESCE(MAX(sequence), 0) FROM chat_lab_events WHERE run_id = %s",
                (run_id,),
            ).fetchone()[0]

    @classmethod
    def create(cls, agent_name: str, session_id: str) -> "ChatEventRecorder":
        if agent_name not in {"phase_one_chatbot", "baseline_chatbot"}:
            raise ValueError("Unknown local chat agent.")
        run_id = uuid4()
        with connect_project_database() as conn:
            conn.execute(
                "INSERT INTO chat_lab_runs (run_id, session_id, agent_name) VALUES (%s, %s, %s)",
                (run_id, session_id, agent_name),
            )
        return cls(run_id)

    def set_turn(self, turn_index: int) -> None:
        if turn_index < 1:
            raise ValueError("turn_index must be positive")
        self.turn_index = turn_index

    def record(
        self,
        kind: str,
        *,
        input=None,
        output=None,
        detail=None,
        duration_ms: float | None = None,
    ) -> int:
        with self._lock:
            self.sequence += 1
            sequence = self.sequence
            with connect_project_database() as conn:
                conn.execute(
                    "INSERT INTO chat_lab_events "
                    "(run_id, sequence, turn_index, kind, duration_ms, input, output, detail) "
                    "VALUES (%s, %s, %s, %s, %s, %s, %s, %s)",
                    (
                        self.run_id,
                        sequence,
                        self.turn_index,
                        kind,
                        duration_ms,
                        Jsonb(_bounded_json(input or {})),
                        Jsonb(_bounded_json(output or {})),
                        Jsonb(_bounded_json(detail or {})),
                    ),
                )
                conn.execute(
                    "UPDATE chat_lab_runs SET updated_at = now() WHERE run_id = %s",
                    (self.run_id,),
                )
            return sequence

    def finish(self, status: str) -> None:
        if status not in {"RUNNING", "COMPLETE", "FAILED"}:
            raise ValueError("Invalid local chat status.")
        with connect_project_database() as conn:
            conn.execute(
                "UPDATE chat_lab_runs SET status = %s, updated_at = now() WHERE run_id = %s",
                (status, self.run_id),
            )


def list_runs(limit: int = 30) -> list[dict]:
    with connect_project_database() as conn:
        rows = conn.execute(
            "SELECT run_id, session_id, agent_name, status, created_at, updated_at "
            "FROM chat_lab_runs ORDER BY updated_at DESC LIMIT %s",
            (max(1, min(limit, 100)),),
        ).fetchall()
    return [
        {
            "run_id": str(run_id), "session_id": session_id,
            "agent_name": agent_name, "status": status,
            "created_at": created_at.isoformat(), "updated_at": updated_at.isoformat(),
        }
        for run_id, session_id, agent_name, status, created_at, updated_at in rows
    ]


def get_run(run_id: UUID) -> dict | None:
    with connect_project_database() as conn:
        run = conn.execute(
            "SELECT run_id, session_id, agent_name, status, created_at, updated_at "
            "FROM chat_lab_runs WHERE run_id = %s", (run_id,)
        ).fetchone()
        if not run:
            return None
        events = conn.execute(
            "SELECT sequence, turn_index, kind, occurred_at, duration_ms, input, output, detail "
            "FROM chat_lab_events WHERE run_id = %s ORDER BY sequence", (run_id,)
        ).fetchall()
    return {
        "run": {
            "run_id": str(run[0]), "session_id": run[1], "agent_name": run[2],
            "status": run[3], "created_at": run[4].isoformat(), "updated_at": run[5].isoformat(),
        },
        "events": [
            {
                "sequence": seq, "turn_index": turn, "kind": kind,
                "occurred_at": occurred.isoformat(), "duration_ms": duration,
                "input": input_data, "output": output_data, "detail": detail_data,
            }
            for seq, turn, kind, occurred, duration, input_data, output_data, detail_data in events
        ],
    }
