# Local ADK chatbot with Codex CLI and RAG

This phase is a small local chatbot. Google ADK owns the agent and conversation
session. A custom text-only ADK model calls the already signed-in Codex CLI for
each answer. It needs no Gemini, OpenAI, or Codex API key in this project.
Codex generation still needs network access and a working Codex sign-in.

The Codex bridge starts an ephemeral `codex exec` process with a read-only
sandbox and no approval pauses. It disables the shell tool, app integrations,
and subagents, ignores global Codex configuration, and uses an empty temporary
working directory under ignored `.local/`. It sends the ADK trusted instruction
and full conversation history on each model call. It reads only the final
`agent_message` JSONL event after a successful `turn.completed` event. This is
a learning prototype; its prompt framing is not a security boundary for prompt
injection.

## Requirements

- Python 3.12
- `uv`
- Codex CLI installed and signed in locally (`codex login status`)

Versions used for Phase 1 validation: Python 3.12.8, Google ADK 2.12.0,
Codex CLI 0.162.1, and uv 0.11.33.

## Phase 1: chat runtime

Phase 1 is complete. Google ADK owns the conversation session, and the custom
text-only model calls the signed-in Codex CLI. The Codex bridge now also
supports a constrained JSON action for ADK-registered functions. Codex's own
shell tool, app integrations, and subagents stay disabled.

## Phase 2: local RAG

Policy Markdown files in `data/policies/` are the editable source of truth.
Each file has a stable `document_id` and integer `version` in YAML front matter.
The first two synthetic versions are `RETURNS-v1.md` (30 days) and
`RETURNS-v2.md` (14 days). PostgreSQL stores the source hash, version, ingestion
jobs/events, active version, passages, and 384-dimensional embeddings. The
embedding model is local and cached under ignored `.local/fastembed/`.

Phase 2 validation used Python 3.12.8, Google ADK 2.12.0, Codex CLI 0.162.1,
FastEmbed 0.9.0, psycopg 3.3.6, and PostgreSQL 18.0. The local embedding model
is `BAAI/bge-small-en-v1.5`.

This project uses an isolated PostgreSQL 18 cluster in ignored
`.local/postgres-data/`, bound to `127.0.0.1:55433`. It does not use the other
local PostgreSQL instance. The ignored `.env` contains the project connection
string; `.env.example` shows its format.

### Start and prepare the RAG database

From this project directory in PowerShell:

```powershell
uv sync --frozen
./scripts/postgres-start.ps1
uv run python -m rag.cli migrate
uv run python -m rag.cli ingest data/policies/RETURNS-v1.md
uv run python -m rag.cli jobs
```

`ingest` reports each state from `PENDING` through `READY`. Re-running an
unchanged version is idempotent. Changed content under the same version is
rejected; add a new Markdown file with the next version number to update the
policy. A new version becomes active only after its passages are ready.

To run the prepared current corpus, `RETURNS v2` is active:

```powershell
uv run python -m chatbot.status
uv run adk web --session_service_uri memory:// --artifact_service_uri memory:// chatbot --host 127.0.0.1 --port 8000 --no-reload
```

Open <http://127.0.0.1:8000> and ask “How long can a customer return a
device?” The current answer should be **14 days**, with a citation such as
`[RETURNS v2, RETURNS-v2-p1]`. The ADK event trace shows the
`search_documents` call and the passage returned to the agent. Ask about a
warranty period; the only ingested policy does not support an answer, so the
agent should abstain.

If port 8000 is already in use by an older ADK server, stop that server with
`Ctrl+C` in its original terminal, then start the command above again so it
loads the current Phase 2 code. You can use port 8001 instead by changing both
`--port 8000` and the URL to `http://127.0.0.1:8001`.

If the ADK CLI asks about telemetry on first run, keep the default off. The web
server uses in-memory sessions and artifacts; conversation history is lost
when it stops. Press `Ctrl+C` in its terminal to stop it. Stop the isolated
database with `./scripts/postgres-stop.ps1` when finished.

Keep the server bound to `127.0.0.1`; the ADK development UI has unauthenticated
endpoints and is intended for trusted local testing.


## RAG ingestion lab

The ingestion lab shows how a policy file becomes searchable. It reads the
same local source files, runs the same ingestion function, and saves its stage
trail in PostgreSQL. It does not call the ADK chat agent. Keep the ADK chat
server on port `8000`; the ingestion lab uses port `8002`.

Start the lab from this project directory in PowerShell:

```powershell
uv sync --frozen
./scripts/postgres-start.ps1
uv run python -m rag.cli migrate
uv run uvicorn rag.lab_api:app --host 127.0.0.1 --port 8002 --workers 1
```

Open <http://127.0.0.1:8002>. Select a policy source, then choose **Run live**
to watch it run or **Step through** to pause after each saved stage. Continue
moves the run forward by one stage. Stop ends it at a stage boundary. Run
history opens saved events in replay mode; replay does not start ingestion.

For a first walkthrough, select `RETURNS-v3.md`. It contains six passages
and is not active yet. Ingesting it will make the fictional 21-day returns
policy active in place of `RETURNS v2` (14 days). The lab also lists the
synthetic shipping fixtures used for local acceptance. Those are separate
documents and do not change the returns policy.

Press `Ctrl+C` in the lab terminal to stop the page. Stop the isolated database
with `./scripts/postgres-stop.ps1` when finished.

### What the lab displays

- The source name, document ID, version, file size, and SHA-256 hash.
- The passages produced by the configured splitter, including real overlap.
- The local embedding model, measured run time, dimension, stored values, and
a heatmap and cosine comparison calculated from those values.
- Planned passage IDs before the final write, then committed IDs and the active
version after the write succeeds.
- Saved stage events and timestamps for live runs, paused runs, and replay.

All displayed artifacts come from the source or the saved ingestion job. The
cosine grid compares passage vectors; it is not a policy quality score. The
lab is a local teaching tool, not a production security boundary.

## Phase 2 behavior and limits

- One root `LlmAgent` with a single read-only `search_documents` ADK function.
- Codex shell, app integrations, and subagents are disabled for each model call.
- ADK's in-memory session service keeps the conversation for the running server.
- The adapter supports text-only messages and one JSON-structured ADK function
  call at a time. It does not support streaming, images, or arbitrary Codex
  tool routing.
- Search reads only ready passages from the active version. It returns at most
  five passages and uses a fixture-calibrated cosine threshold; re-evaluate the
  threshold as the corpus grows.
- Only the fictional returns policy is loaded. The current phase has no role
  access control, user authentication, prompt-injection experiment, ingestion
  worker, retry queue, or production deployment.
- Retrieved text is treated as untrusted data by the instructions, but this
  small demo is not a production security boundary.

## Validation completed

- Phase 1 locked install, CLI adapter, and multi-turn checks passed.
- Phase 2 migration applied twice safely; the returns source ingested to one
  passage with all six job states. Same-hash ingestion was idempotent, changed
  content under v1 was rejected, and an injected embedding failure was recorded
  before a successful v2 retry.
- The active v2 returned `RETURNS-v2-p1` with a similarity score above the
  fixture threshold. The warranty question returned no passages.
- A live ADK/Codex conversation invoked `search_documents`, answered **14
  days** with a matching citation, then abstained on the unsupported warranty
  question. Both turns and tool events remained in the in-memory ADK session.
- Stub runs confirmed safe errors for missing Codex CLI, timeout, nonzero exit,
  and malformed JSONL. Codex's constrained JSON response contract was also
  tested against the live CLI and through ADK's function-call loop.

Phase 2 is a local learning demo. It does not establish production security,
role-based access, or general prompt-injection resistance.
