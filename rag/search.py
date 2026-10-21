"""Shared two-stage search over passages from active policy versions."""

from __future__ import annotations

import json
import time

import numpy as np

from rag.database import connect_project_database
from rag.embeddings import embed_texts
from rag.reranker import Reranker, get_reranker
from chatbot.event_context import current_recorder


MAX_RESULTS = 5
CANDIDATE_LIMIT = 20
# Retained for comparison with the original cosine-only lab. It is intentionally
# not applied: cosine and cross-encoder score scales are not interchangeable.
MIN_SIMILARITY = 0.72
# Empirical fixture floor. This is an abstention heuristic, not a confidence
# value. Keep it low enough to preserve multi-fact evidence in local fixtures.
MIN_RERANK_SCORE = 0.001


def _validate_query(query: str) -> str:
    if not isinstance(query, str):
        raise ValueError("Enter a short policy question.")
    query = query.strip()
    if not query or len(query) > 1000:
        raise ValueError("Enter a short policy question (1–1000 characters).")
    return query


def retrieve_detailed(
    query: str,
    top_k: int = MAX_RESULTS,
    *,
    reranker: Reranker | None = None,
    candidate_limit: int = CANDIDATE_LIMIT,
) -> dict:
    """Return cosine shortlist, reranked candidates, selection and active versions."""
    query = _validate_query(query)
    try:
        requested = int(top_k)
    except (TypeError, ValueError) as exc:
        raise ValueError("top_k must be between 1 and 5.") from exc
    if requested < 1 or requested > MAX_RESULTS:
        raise ValueError("top_k must be between 1 and 5.")
    if candidate_limit < 1:
        raise ValueError("candidate_limit must be positive.")

    query_vector = np.asarray(embed_texts([query])[0], dtype=np.float32)
    with connect_project_database() as conn:
        active_versions = conn.execute(
            "SELECT document_id, version FROM active_document_versions ORDER BY document_id"
        ).fetchall()
        rows = conn.execute(
            "SELECT p.passage_id, p.document_id, p.version, p.content, p.embedding "
            "FROM policy_passages AS p "
            "JOIN active_document_versions AS a "
            "  ON a.document_id = p.document_id AND a.version = p.version "
            "JOIN document_versions AS v "
            "  ON v.document_id = p.document_id AND v.version = p.version "
            "WHERE v.status = 'READY'"
        ).fetchall()

    query_norm = float(np.linalg.norm(query_vector))
    if not query_norm:
        raise RuntimeError("The query could not be embedded.")
    cosine_candidates = []
    for passage_id, document_id, version, content, stored_vector in rows:
        vector = np.asarray(stored_vector, dtype=np.float32)
        denom = query_norm * float(np.linalg.norm(vector))
        score = float(np.dot(query_vector, vector) / denom) if denom else 0.0
        cosine_candidates.append({
            "passage_id": passage_id,
            "document_id": document_id,
            "version": version,
            "text": content,
            "cosine_score": round(score, 6),
        })
    cosine_candidates.sort(key=lambda item: (-item["cosine_score"], item["passage_id"]))
    cosine_candidates = cosine_candidates[:min(candidate_limit, CANDIDATE_LIMIT)]
    for rank, item in enumerate(cosine_candidates, start=1):
        item["cosine_rank"] = rank

    if cosine_candidates:
        ranked = (reranker or get_reranker()).rerank(query, cosine_candidates)
    else:
        ranked = []
    ranked.sort(key=lambda item: (-item["rerank_score"], item["passage_id"]))
    for rank, item in enumerate(ranked, start=1):
        item["rerank_score"] = round(float(item["rerank_score"]), 6)
        item["rerank_rank"] = rank
    eligible = [item for item in ranked if item["rerank_score"] >= MIN_RERANK_SCORE]
    selected = eligible[:requested]
    results = [
        {key: item[key] for key in ("passage_id", "document_id", "version", "text")}
        for item in selected
    ]
    message = "Relevant active passages found." if selected else "No active ready policy passage was found above the local rerank selection floor."
    tool_result = {"results": results, "message": message}
    return {
        "query": query,
        "candidate_limit": min(candidate_limit, CANDIDATE_LIMIT),
        "active_versions": [{"document_id": doc, "version": version} for doc, version in active_versions],
        "cosine_candidates": cosine_candidates,
        "reranked_candidates": ranked,
        "selected": selected,
        "results": results,
        "message": message,
        "tool_result": tool_result,
        "tool_result_characters": len(json.dumps(tool_result, ensure_ascii=False)),
    }


def search_documents(query: str, top_k: int = MAX_RESULTS) -> dict:
    """ADK tool contract; exposes only selected passages and plain status text."""
    recorder = current_recorder()
    started = time.perf_counter()
    try:
        detail = retrieve_detailed(query, top_k)
    except (ValueError, RuntimeError) as exc:
        result = {"results": [], "message": str(exc)}
        if recorder:
            recorder.record(
                "search", input={"query": query, "top_k": top_k},
                output={"passage_ids": [], "result_count": 0},
                detail={"error": str(exc)},
                duration_ms=(time.perf_counter() - started) * 1000,
            )
        return result
    result = {"results": detail["results"], "message": detail["message"]}
    if recorder:
        recorder.record(
            "search",
            input={"query": detail["query"], "top_k": max(1, min(int(top_k), MAX_RESULTS))},
            output={
                "passage_ids": [item["passage_id"] for item in detail["results"]],
                "result_count": len(detail["results"]),
                "tool_result_characters": detail["tool_result_characters"],
            },
            detail={
                "active_versions": detail["active_versions"],
                "candidate_limit": detail["candidate_limit"],
                "cosine_candidates": detail["cosine_candidates"],
                "reranked_candidates": detail["reranked_candidates"],
                "tool_result": result,
            },
            duration_ms=(time.perf_counter() - started) * 1000,
        )
    return result
