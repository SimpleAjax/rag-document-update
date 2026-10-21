"""Local chat event and replay API for the retrieval teaching lab."""

from __future__ import annotations

from pathlib import Path
from typing import Literal
from uuid import UUID

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from chatbot.lab_runtime import runtime
from chatbot import cache_lab


WEB_DIR = Path(__file__).resolve().parent / "lab_web"
app = FastAPI(title="Cimulink Local Chat Lab", docs_url=None, redoc_url=None)
app.mount("/static", StaticFiles(directory=WEB_DIR), name="static")


class NewSessionRequest(BaseModel):
    agent_name: Literal["phase_one_chatbot", "baseline_chatbot"]


class MessageRequest(BaseModel):
    question: str = Field(min_length=1, max_length=1000)


class CachePreflightRequest(BaseModel):
    mode: str
    output_token_cap: int = Field(default=1000, ge=1, le=1000)


class CacheStartRequest(CachePreflightRequest):
    acknowledged_budget: bool = False


class CacheRefetchRequest(BaseModel):
    passage_id: str = Field(min_length=1, max_length=100)


class CacheQualityReviewRequest(BaseModel):
    correct_answer: bool | None = None
    correct_citation: bool | None = None
    qualifier_preserved: bool | None = None
    refetch_behavior_correct: bool | None = None
    unsupported_claims: bool | None = None
    notes: str = Field(default="", max_length=2000)


@app.get("/", include_in_schema=False)
def home() -> FileResponse:
    return FileResponse(WEB_DIR / "index.html")


@app.post("/api/sessions", status_code=201)
async def create_session(request: NewSessionRequest) -> dict:
    try:
        return await runtime.create_session(request.agent_name)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc


@app.post("/api/sessions/{session_id}/messages", status_code=202)
async def send_message(session_id: str, request: MessageRequest) -> dict:
    try:
        return await runtime.start_turn(session_id, request.question)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    except LookupError as exc:
        raise HTTPException(404, str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(409, str(exc)) from exc


@app.get("/api/sessions/{session_id}")
def get_session(session_id: str) -> dict:
    available = runtime.session_available(session_id)
    return {
        "session_id": session_id,
        "available": available,
        "message": "Live ADK session is available." if available else "Live ADK session expired; start a new session. Saved runs remain replayable.",
    }


@app.get("/api/runs")
def list_chat_runs() -> dict:
    return {"runs": runtime.runs()}


@app.get("/api/runs/{run_id}")
def get_chat_run(run_id: UUID) -> dict:
    result = runtime.replay(run_id)
    if result is None:
        raise HTTPException(404, "Saved chat run was not found.")
    return result


@app.get("/api/cache-lab/metadata")
def cache_lab_metadata() -> dict:
    return cache_lab.metadata()


@app.post("/api/cache-lab/preflight")
def cache_lab_preflight(request: CachePreflightRequest) -> dict:
    try:
        return cache_lab.preflight(request.mode, request.output_token_cap)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc


@app.post("/api/cache-lab/runs", status_code=201)
def cache_lab_start(request: CacheStartRequest) -> dict:
    try:
        return cache_lab.start_v2(request.mode, request.output_token_cap, request.acknowledged_budget)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(409, str(exc)) from exc


@app.get("/api/cache-lab/runs")
def cache_lab_runs() -> dict:
    return {"runs": cache_lab.list_runs()}


@app.get("/api/cache-lab/runs/{variant_id}")
def cache_lab_get_run(variant_id: UUID) -> dict:
    result = cache_lab.get_run(variant_id)
    if result is None:
        raise HTTPException(404, "Cache lab run was not found.")
    return result


@app.get("/api/cache-lab/runs/{variant_id}/replay")
def cache_lab_replay(variant_id: UUID) -> dict:
    result = cache_lab.replay(variant_id)
    if result is None:
        raise HTTPException(404, "Cache lab run was not found.")
    return result


@app.post("/api/cache-lab/runs/{variant_id}/refetch")
def cache_lab_refetch(variant_id: UUID, request: CacheRefetchRequest) -> dict:
    try:
        return cache_lab.refetch(variant_id, request.passage_id)
    except LookupError as exc:
        raise HTTPException(404, str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc


@app.post("/api/cache-lab/runs/{variant_id}/quality")
def cache_lab_quality_review(variant_id: UUID, request: CacheQualityReviewRequest) -> dict:
    try:
        return cache_lab.save_quality_review(variant_id, request.model_dump())
    except LookupError as exc:
        raise HTTPException(404, str(exc)) from exc


@app.get("/api/cache-lab/runs/{variant_id}/export")
def cache_lab_export(variant_id: UUID, format: str = "json"):
    from fastapi.responses import Response
    try:
        body, media_type = cache_lab.export_run(variant_id, format)
    except LookupError as exc:
        raise HTTPException(404, str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    return Response(body, media_type=media_type, headers={"Content-Disposition": f'attachment; filename="cache-lab-{variant_id}.{format}"'})
