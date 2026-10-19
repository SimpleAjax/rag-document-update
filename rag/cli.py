"""Commands for project migrations, policy ingestion, and job inspection."""

from __future__ import annotations

import argparse
import sys
from uuid import UUID

from rag.database import DatabaseConfigurationError, apply_migrations, connect_project_database
from rag.documents import DocumentValidationError
from rag.ingestion import ingest_policy


def _migrate() -> int:
    applied = apply_migrations()
    if applied:
        print(f"Applied migration: {', '.join(applied)}")
    else:
        print("Database schema is already current.")
    return 0


def _ingest(path: str) -> int:
    result = ingest_policy(
        path,
        on_state=lambda state, detail: print(f"{state}: {detail}"),
    )
    if result.already_ready:
        print(
            f"{result.document_id} v{result.version} is already ready; no duplicate passages were written."
        )
    else:
        print(
            f"Ready: {result.document_id} v{result.version}; "
            f"passages={result.passage_count}; job_id={result.job_id}"
        )
    return 0


def _jobs(job_id: str | None) -> int:
    with connect_project_database() as conn:
        if job_id:
            parsed_id = UUID(job_id)
            jobs = conn.execute(
                "SELECT job_id, document_id, version, status, error_message, created_at, completed_at "
                "FROM ingestion_jobs WHERE job_id = %s",
                (parsed_id,),
            ).fetchall()
        else:
            jobs = conn.execute(
                "SELECT job_id, document_id, version, status, error_message, created_at, completed_at "
                "FROM ingestion_jobs ORDER BY created_at DESC LIMIT 20"
            ).fetchall()
        if not jobs:
            print("No ingestion jobs found.")
            return 0
        for job in jobs:
            jid, doc_id, version, status, error, created, completed = job
            print(f"{jid}  {doc_id} v{version}  {status}  created={created}  completed={completed}")
            if error:
                print(f"  error={error}")
            events = conn.execute(
                "SELECT sequence, status, detail, occurred_at FROM ingestion_job_events "
                "WHERE job_id = %s ORDER BY sequence",
                (jid,),
            ).fetchall()
            for sequence, event_status, detail, occurred in events:
                print(f"  {sequence}. {event_status} {occurred}: {detail}")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="rag")
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("migrate", help="Apply project database migrations safely.")
    ingest = commands.add_parser("ingest", help="Ingest one Markdown policy source.")
    ingest.add_argument("path", help="Markdown file under data/policies/.")
    jobs = commands.add_parser("jobs", help="Show recent ingestion jobs and their events.")
    jobs.add_argument("job_id", nargs="?", help="Optional ingestion job UUID.")
    args = parser.parse_args(argv)

    try:
        if args.command == "migrate":
            return _migrate()
        if args.command == "ingest":
            return _ingest(args.path)
        if args.command == "jobs":
            return _jobs(args.job_id)
    except (DatabaseConfigurationError, DocumentValidationError, ValueError) as exc:
        print(f"Error: {exc}", file=sys.stderr)
        return 2
    except Exception as exc:
        print(f"Error: operation failed ({type(exc).__name__}).", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
