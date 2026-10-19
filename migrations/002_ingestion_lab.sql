ALTER TABLE ingestion_jobs
    ADD COLUMN IF NOT EXISTS run_mode TEXT NOT NULL DEFAULT 'CLI'
    CHECK (run_mode IN ('CLI', 'LIVE', 'STEP'));

ALTER TABLE ingestion_job_events
    ADD COLUMN IF NOT EXISTS payload JSONB NOT NULL DEFAULT '{}'::jsonb;
