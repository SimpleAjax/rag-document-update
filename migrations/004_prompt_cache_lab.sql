CREATE TABLE IF NOT EXISTS cache_lab_experiments (
    experiment_id UUID PRIMARY KEY,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    scenario_id TEXT NOT NULL,
    scenario_version TEXT NOT NULL,
    model TEXT NOT NULL,
    settings JSONB NOT NULL,
    rate_snapshot JSONB NOT NULL,
    budget_cap_usd NUMERIC(10, 6) NOT NULL,
    status TEXT NOT NULL,
    spend_estimate_usd NUMERIC(10, 6) NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS cache_lab_variants (
    variant_id UUID PRIMARY KEY,
    experiment_id UUID NOT NULL REFERENCES cache_lab_experiments(experiment_id) ON DELETE CASCADE,
    mode TEXT NOT NULL,
    prefix_version TEXT NOT NULL,
    checkpoint_version TEXT NOT NULL,
    prompt_hash TEXT NOT NULL,
    settings_hash TEXT NOT NULL,
    status TEXT NOT NULL,
    started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    ended_at TIMESTAMPTZ,
    quality_review JSONB
);
CREATE TABLE IF NOT EXISTS cache_lab_events (
    variant_id UUID NOT NULL REFERENCES cache_lab_variants(variant_id) ON DELETE CASCADE,
    sequence INTEGER NOT NULL CHECK (sequence > 0),
    turn_index INTEGER NOT NULL CHECK (turn_index > 0),
    kind TEXT NOT NULL,
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    duration_ms DOUBLE PRECISION CHECK (duration_ms IS NULL OR duration_ms >= 0),
    input JSONB NOT NULL DEFAULT '{}'::jsonb,
    output JSONB NOT NULL DEFAULT '{}'::jsonb,
    detail JSONB NOT NULL DEFAULT '{}'::jsonb,
    PRIMARY KEY (variant_id, sequence)
);
CREATE INDEX IF NOT EXISTS cache_lab_experiments_created_idx ON cache_lab_experiments(created_at DESC);
CREATE INDEX IF NOT EXISTS cache_lab_variants_experiment_idx ON cache_lab_variants(experiment_id);
