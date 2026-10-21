CREATE TABLE IF NOT EXISTS chat_lab_runs (
    run_id UUID PRIMARY KEY,
    session_id TEXT NOT NULL,
    agent_name TEXT NOT NULL CHECK (agent_name IN ('phase_one_chatbot', 'baseline_chatbot')),
    status TEXT NOT NULL DEFAULT 'RUNNING' CHECK (status IN ('RUNNING', 'COMPLETE', 'FAILED')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS chat_lab_events (
    run_id UUID NOT NULL REFERENCES chat_lab_runs(run_id) ON DELETE CASCADE,
    sequence INTEGER NOT NULL CHECK (sequence > 0),
    turn_index INTEGER NOT NULL CHECK (turn_index > 0),
    kind TEXT NOT NULL CHECK (kind IN (
        'user', 'model_input', 'model_decision', 'tool_call', 'search',
        'tool_result', 'answer', 'error'
    )),
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    duration_ms DOUBLE PRECISION CHECK (duration_ms IS NULL OR duration_ms >= 0),
    input JSONB NOT NULL DEFAULT '{}'::jsonb,
    output JSONB NOT NULL DEFAULT '{}'::jsonb,
    detail JSONB NOT NULL DEFAULT '{}'::jsonb,
    PRIMARY KEY (run_id, sequence)
);

CREATE INDEX IF NOT EXISTS chat_lab_runs_updated_idx
    ON chat_lab_runs (updated_at DESC);
CREATE INDEX IF NOT EXISTS chat_lab_events_run_turn_idx
    ON chat_lab_events (run_id, turn_index, sequence);
