"""Context-local bridge for optional local chat event capture."""

from __future__ import annotations

from contextvars import ContextVar
from typing import Any


_current_recorder: ContextVar[Any | None] = ContextVar("chat_event_recorder", default=None)


def current_recorder():
    return _current_recorder.get()


def use_recorder(recorder):
    return _current_recorder.set(recorder)


def reset_recorder(token) -> None:
    _current_recorder.reset(token)
