"""Read-only cosine search over passages from active policy versions."""

from __future__ import annotations

import numpy as np

from rag.database import connect_project_database
from rag.embeddings import embed_texts


MAX_RESULTS = 5
# Conservative fixture-level cutoff; re-evaluate when the corpus grows.
MIN_SIMILARITY = 0.72


def search_documents(query: str, top_k: int = MAX_RESULTS) -> dict:
    """Return relevant passages from active, ready policy versions only."""
    query = query.strip()
    if not query or len(query) > 1000:
        return {"results": [], "message": "Enter a short policy question."}
    top_k = max(1, min(int(top_k), MAX_RESULTS))
    query_vector = np.asarray(embed_texts([query])[0], dtype=np.float32)

    with connect_project_database() as conn:
        rows = conn.execute(
            "SELECT p.passage_id, p.document_id, p.version, p.content, p.embedding "
            "FROM policy_passages AS p "
            "JOIN active_document_versions AS a "
            "  ON a.document_id = p.document_id AND a.version = p.version "
            "JOIN document_versions AS v "
            "  ON v.document_id = p.document_id AND v.version = p.version "
            "WHERE v.status = 'READY'"
        ).fetchall()

    scored: list[dict] = []
    query_norm = float(np.linalg.norm(query_vector))
    if not query_norm:
        return {"results": [], "message": "The query could not be embedded."}
    for passage_id, document_id, version, content, stored_vector in rows:
        vector = np.asarray(stored_vector, dtype=np.float32)
        denom = query_norm * float(np.linalg.norm(vector))
        score = float(np.dot(query_vector, vector) / denom) if denom else 0.0
        scored.append(
            {
                "passage_id": passage_id,
                "document_id": document_id,
                "version": version,
                "score": round(score, 4),
                "text": content,
            }
        )
    scored.sort(key=lambda item: item["score"], reverse=True)
    selected = [item for item in scored if item["score"] >= MIN_SIMILARITY][:top_k]
    return {
        "results": selected,
        "message": "Relevant active passages found." if selected else "No relevant active policy passage was found.",
    }
