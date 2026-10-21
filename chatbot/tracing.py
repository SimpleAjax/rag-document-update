"""Optional Langfuse tracing for the local Google ADK chat agents."""

from __future__ import annotations

import atexit
import logging
import os
from pathlib import Path

from dotenv import load_dotenv


logger = logging.getLogger(__name__)
PROJECT_ROOT = Path(__file__).resolve().parents[1]
_initialized = False


def initialize_langfuse() -> bool:
    """Enable ADK-to-Langfuse tracing when project credentials are configured."""
    global _initialized
    if _initialized:
        return True
    if os.environ.get("RAG_DISABLE_LANGFUSE") == "1":
        logger.info("Langfuse tracing is disabled by RAG_DISABLE_LANGFUSE.")
        return False

    load_dotenv(PROJECT_ROOT / ".env")
    required = (
        "LANGFUSE_PUBLIC_KEY",
        "LANGFUSE_SECRET_KEY",
        "LANGFUSE_BASE_URL",
    )
    configured = {name: bool(os.environ.get(name, "").strip()) for name in required}
    if not any(configured.values()):
        logger.info("Langfuse tracing is disabled; add credentials to the project .env to enable it.")
        return False
    missing = [name for name, present in configured.items() if not present]
    if missing:
        raise RuntimeError(
            "Langfuse configuration is incomplete. Set all three values in .env: "
            + ", ".join(missing)
        )

    from langfuse import get_client
    from openinference.instrumentation.google_adk import GoogleADKInstrumentor

    client = get_client()
    GoogleADKInstrumentor().instrument()
    atexit.register(client.flush)
    _initialized = True
    logger.info("Langfuse tracing is enabled for Google ADK chat runs.")
    return True
