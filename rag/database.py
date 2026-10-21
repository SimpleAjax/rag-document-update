"""Project-scoped PostgreSQL connection and repeatable migration runner."""

from __future__ import annotations

import json
import os
from functools import partial
from pathlib import Path

import psycopg
from dotenv import load_dotenv
from psycopg.conninfo import conninfo_to_dict
from psycopg.types.json import set_json_loads


PROJECT_ROOT = Path(__file__).resolve().parents[1]
DATA_DIRECTORY = PROJECT_ROOT / ".local" / "postgres-data"
MIGRATIONS_DIR = PROJECT_ROOT / "migrations"
EXPECTED_DATABASE = "rag_document_update"
EXPECTED_PORT = 55433


def _load_json(data: bytes, *, encoding: str):
    return json.loads(data.decode(encoding))


class DatabaseConfigurationError(RuntimeError):
    """The configured database is missing or is not the isolated project target."""


def _database_url() -> str:
    load_dotenv(PROJECT_ROOT / ".env")
    value = os.environ.get("RAG_DATABASE_URL", "").strip()
    if not value:
        raise DatabaseConfigurationError(
            "Set RAG_DATABASE_URL in the ignored project .env file."
        )
    info = conninfo_to_dict(value)
    if info.get("host") not in {"127.0.0.1", "localhost"}:
        raise DatabaseConfigurationError("The RAG database must be on this computer.")
    if info.get("dbname") != EXPECTED_DATABASE:
        raise DatabaseConfigurationError(
            f"The RAG database name must be {EXPECTED_DATABASE}."
        )
    try:
        port = int(info.get("port", "5432"))
    except ValueError as exc:
        raise DatabaseConfigurationError("The RAG database port is invalid.") from exc
    if port != EXPECTED_PORT:
        raise DatabaseConfigurationError(
            f"The isolated project PostgreSQL target must use port {EXPECTED_PORT}."
        )
    return value


def connect_project_database() -> psycopg.Connection:
    """Connect only to the loopback, project-named PostgreSQL target."""
    conn = psycopg.connect(
        _database_url(), connect_timeout=4, application_name="rag-document-update"
    )
    try:
        database, port, data_dir, server_encoding = conn.execute(
            "SELECT current_database(), inet_server_port(), current_setting('data_directory'), "
            "current_setting('server_encoding')"
        ).fetchone()
        expected_dir = os.path.normcase(os.path.realpath(DATA_DIRECTORY))
        actual_dir = os.path.normcase(os.path.realpath(data_dir))
        if (
            database != EXPECTED_DATABASE
            or port != EXPECTED_PORT
            or actual_dir != expected_dir
        ):
            raise DatabaseConfigurationError(
                "Connected PostgreSQL identity does not match the isolated project target."
            )
        # PostgreSQL's binary JSONB protocol returns bytes in the server
        # encoding. psycopg's default JSON loader assumes those bytes are
        # UTF-8, which breaks when a local Windows cluster uses WIN1252.
        json_codec = {
            "UTF8": "utf-8",
            "WIN1252": "cp1252",
        }.get(server_encoding, server_encoding.lower())
        set_json_loads(
            partial(_load_json, encoding=json_codec),
            conn,
        )
        conn.rollback()
        return conn
    except Exception:
        conn.close()
        raise


def apply_migrations() -> list[str]:
    """Apply unapplied project migrations; this never drops or resets data."""
    migrations = sorted(MIGRATIONS_DIR.glob("[0-9][0-9][0-9]_*.sql"))
    if not migrations:
        raise DatabaseConfigurationError("No project SQL migrations were found.")
    applied_now: list[str] = []
    with connect_project_database() as conn:
        for migration in migrations:
            has_migration_table = conn.execute(
                "SELECT to_regclass('public.schema_migrations') IS NOT NULL"
            ).fetchone()[0]
            already_applied = False
            if has_migration_table:
                already_applied = conn.execute(
                    "SELECT 1 FROM schema_migrations WHERE migration_id = %s",
                    (migration.name,),
                ).fetchone() is not None
            conn.rollback()
            if already_applied:
                continue

            sql_text = migration.read_text(encoding="utf-8")
            statements = [
                statement.strip()
                for statement in sql_text.split(";")
                if statement.strip()
            ]
            with conn.transaction():
                for statement in statements:
                    conn.execute(statement)
                conn.execute(
                    "INSERT INTO schema_migrations (migration_id) VALUES (%s) ON CONFLICT DO NOTHING",
                    (migration.name,),
                )
            applied_now.append(migration.name)
    return applied_now
