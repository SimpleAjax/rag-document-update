"""Lazy local FlashRank wrapper for query-time candidate reranking."""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import Protocol


PROJECT_ROOT = Path(__file__).resolve().parents[1]
MODEL_NAME = "ms-marco-MiniLM-L-12-v2"


class Reranker(Protocol):
    def rerank(self, query: str, passages: list[dict]) -> list[dict]: ...


class FlashRankReranker:
    """Adapt FlashRank's request/result API to plain candidate dictionaries."""

    def __init__(self, ranker=None):
        self._ranker = ranker

    def _load(self):
        if self._ranker is None:
            try:
                from flashrank import Ranker

                cache = PROJECT_ROOT / ".local" / "flashrank"
                cache.mkdir(parents=True, exist_ok=True)
                self._ranker = Ranker(
                    model_name=MODEL_NAME, cache_dir=str(cache), max_length=512
                )
            except Exception as exc:
                raise RuntimeError(
                    "The local reranker could not load. Check the model download and .local/flashrank cache."
                ) from exc
        return self._ranker

    def rerank(self, query: str, passages: list[dict]) -> list[dict]:
        if not passages:
            return []
        try:
            from flashrank import RerankRequest

            ranker = self._load()
            ranked = ranker.rerank(
                RerankRequest(
                    query=query,
                    passages=[{"id": str(i), "text": item["text"]} for i, item in enumerate(passages)],
                )
            )
            result = []
            for row in ranked:
                item = dict(passages[int(row["id"])])
                item["rerank_score"] = float(row["score"])
                result.append(item)
            if len(result) != len(passages):
                raise ValueError("Reranker returned an incomplete candidate list.")
            return result
        except Exception as exc:
            if isinstance(exc, RuntimeError) and str(exc).startswith("The local reranker"):
                raise
            raise RuntimeError(
                "The local reranker failed during inference. Check the model cache and passage input."
            ) from exc


@lru_cache(maxsize=1)
def get_reranker() -> FlashRankReranker:
    return FlashRankReranker()
