CREATE TABLE IF NOT EXISTS policy_documents (
    document_id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS document_versions (
    document_id TEXT NOT NULL REFERENCES policy_documents(document_id),
    version INTEGER NOT NULL CHECK (version > 0),
    source_path TEXT NOT NULL,
    source_sha256 CHAR(64) NOT NULL,
    status TEXT NOT NULL CHECK (
        status IN ('PENDING', 'VALIDATING', 'CHUNKING', 'EMBEDDING', 'INDEXING', 'READY', 'FAILED')
    ),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    ready_at TIMESTAMPTZ,
    PRIMARY KEY (document_id, version)
);

CREATE TABLE IF NOT EXISTS active_document_versions (
    document_id TEXT PRIMARY KEY REFERENCES policy_documents(document_id),
    version INTEGER NOT NULL,
    activated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    FOREIGN KEY (document_id, version)
        REFERENCES document_versions(document_id, version)
);

CREATE TABLE IF NOT EXISTS ingestion_jobs (
    job_id UUID PRIMARY KEY,
    document_id TEXT NOT NULL,
    version INTEGER NOT NULL,
    status TEXT NOT NULL CHECK (
        status IN ('PENDING', 'VALIDATING', 'CHUNKING', 'EMBEDDING', 'INDEXING', 'READY', 'FAILED')
    ),
    error_message TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at TIMESTAMPTZ,
    FOREIGN KEY (document_id, version)
        REFERENCES document_versions(document_id, version)
);

CREATE TABLE IF NOT EXISTS ingestion_job_events (
    event_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    job_id UUID NOT NULL REFERENCES ingestion_jobs(job_id) ON DELETE CASCADE,
    sequence INTEGER NOT NULL,
    status TEXT NOT NULL,
    detail TEXT NOT NULL DEFAULT '',
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (job_id, sequence)
);

CREATE TABLE IF NOT EXISTS policy_passages (
    passage_id TEXT PRIMARY KEY,
    document_id TEXT NOT NULL,
    version INTEGER NOT NULL,
    passage_index INTEGER NOT NULL CHECK (passage_index >= 0),
    content TEXT NOT NULL,
    embedding DOUBLE PRECISION[] NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    FOREIGN KEY (document_id, version)
        REFERENCES document_versions(document_id, version) ON DELETE CASCADE,
    UNIQUE (document_id, version, passage_index),
    CHECK (array_length(embedding, 1) = 384)
);

CREATE INDEX IF NOT EXISTS ix_policy_passages_version
    ON policy_passages (document_id, version);

CREATE TABLE IF NOT EXISTS schema_migrations (
    migration_id TEXT PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
