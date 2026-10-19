"""Local FastEmbed model wrapper."""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path

import numpy as np
from fastembed import TextEmbedding


PROJECT_ROOT = Path(__file__).resolve().parents[1]
MODEL_NAME = "BAAI/bge-small-en-v1.5"
DIMENSIONS = 384


@lru_cache(maxsize=1)
def _model() -> TextEmbedding:
    cache = PROJECT_ROOT / ".local" / "fastembed"
    cache.mkdir(parents=True, exist_ok=True)
    return TextEmbedding(
        model_name=MODEL_NAME,
        cache_dir=str(cache),
        threads=2,
        lazy_load=False,
    )


def embed_texts(texts: list[str]) -> list[list[float]]:
    if not texts:
        return []
    vectors = [np.asarray(vector, dtype=np.float32) for vector in _model().embed(texts)]
    if any(vector.shape != (DIMENSIONS,) or not np.isfinite(vector).all() for vector in vectors):
        raise ValueError("Embedding model returned an invalid vector.")
    return [vector.astype(float).tolist() for vector in vectors]
