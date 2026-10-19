"""Markdown source parsing and deterministic passage splitting."""

from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass
from pathlib import Path

import yaml


PROJECT_ROOT = Path(__file__).resolve().parents[1]
POLICY_DIR = PROJECT_ROOT / "data" / "policies"
MAX_CHARS = 650
OVERLAP_CHARS = 80


class DocumentValidationError(ValueError):
    """A policy source is missing or has invalid metadata/content."""


@dataclass(frozen=True)
class PolicyDocument:
    document_id: str
    version: int
    title: str
    source_path: str
    source_sha256: str
    source_text: str
    body: str


@dataclass(frozen=True)
class PassageDetails:
    text: str
    passage_index: int
    paragraph_indexes: tuple[int, ...]
    start_offset: int | None
    end_offset: int | None
    overlap_with_previous: int


def load_policy(path: str | Path) -> PolicyDocument:
    source = Path(path).resolve()
    if not source.is_relative_to(POLICY_DIR.resolve()) or source.suffix.lower() != ".md":
        raise DocumentValidationError("Policy sources must be Markdown files inside data/policies/.")
    raw = source.read_text(encoding="utf-8")
    match = re.match(r"\A---\s*\r?\n(.*?)\r?\n---\s*\r?\n(.*)\Z", raw, re.S)
    if not match:
        raise DocumentValidationError("Policy source must start with YAML front matter.")
    try:
        metadata = yaml.safe_load(match.group(1))
    except yaml.YAMLError as exc:
        raise DocumentValidationError("Policy front matter is not valid YAML.") from exc
    if not isinstance(metadata, dict):
        raise DocumentValidationError("Policy front matter must be a mapping.")
    document_id = metadata.get("document_id")
    version = metadata.get("version")
    title = metadata.get("title")
    body = match.group(2).strip()
    if not isinstance(document_id, str) or not re.fullmatch(r"[A-Z][A-Z0-9_-]{1,31}", document_id):
        raise DocumentValidationError("document_id must use uppercase letters, digits, _ or -.")
    if isinstance(version, bool) or not isinstance(version, int) or version < 1:
        raise DocumentValidationError("version must be a positive integer.")
    if not isinstance(title, str) or not title.strip() or not body:
        raise DocumentValidationError("Policy title and body are required.")
    return PolicyDocument(
        document_id=document_id,
        version=version,
        title=title.strip(),
        source_path=source.relative_to(PROJECT_ROOT).as_posix(),
        source_sha256=hashlib.sha256(raw.encode("utf-8")).hexdigest(),
        source_text=raw,
        body=body,
    )


def split_passages_detailed(
    text: str, max_chars: int = MAX_CHARS
) -> list[PassageDetails]:
    if max_chars < 100:
        raise ValueError("max_chars must be at least 100.")
    paragraphs = [part.strip() for part in re.split(r"\n\s*\n", text) if part.strip()]
    passages: list[PassageDetails] = []
    current = ""
    current_paragraphs: list[int] = []
    for paragraph_index, paragraph in enumerate(paragraphs):
        if len(paragraph) > max_chars:
            if current:
                passages.append(
                    PassageDetails(
                        current,
                        len(passages),
                        tuple(current_paragraphs),
                        None,
                        None,
                        0,
                    )
                )
                current = ""
                current_paragraphs = []
            start = 0
            previous_end: int | None = None
            while start < len(paragraph):
                end = min(start + max_chars, len(paragraph))
                if end < len(paragraph):
                    boundary = paragraph.rfind(" ", start, end)
                    if boundary > start + max_chars // 2:
                        end = boundary
                segment = paragraph[start:end]
                left_trim = len(segment) - len(segment.lstrip())
                passage_text = segment.strip()
                actual_start = start + left_trim
                actual_end = actual_start + len(passage_text)
                overlap = max(0, previous_end - actual_start) if previous_end is not None else 0
                passages.append(
                    PassageDetails(
                        passage_text,
                        len(passages),
                        (paragraph_index,),
                        actual_start,
                        actual_end,
                        overlap,
                    )
                )
                previous_end = actual_end
                if end >= len(paragraph):
                    break
                start = max(start + 1, end - OVERLAP_CHARS)
            continue
        candidate = f"{current}\n\n{paragraph}" if current else paragraph
        if current and len(candidate) > max_chars:
            passages.append(
                PassageDetails(
                    current,
                    len(passages),
                    tuple(current_paragraphs),
                    None,
                    None,
                    0,
                )
            )
            current = paragraph
            current_paragraphs = [paragraph_index]
        else:
            current = candidate
            current_paragraphs.append(paragraph_index)
    if current:
        passages.append(
            PassageDetails(
                current,
                len(passages),
                tuple(current_paragraphs),
                None,
                None,
                0,
            )
        )
    return passages


def split_passages(text: str, max_chars: int = MAX_CHARS) -> list[str]:
    """Return passage text, preserving the original public helper contract."""
    return [part.text for part in split_passages_detailed(text, max_chars)]
