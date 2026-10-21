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

The prepared local corpus has `RETURNS v3` and `SHIPPING v2` active:

```powershell
uv run python -m chatbot.status
uv run adk web --session_service_uri memory:// --artifact_service_uri memory:// chatbot --host 127.0.0.1 --port 8000 --no-reload
```

Open <http://127.0.0.1:8000> and ask “How long can a customer return a
device?” The current answer should be **21 days**, with a citation such as
`[RETURNS v3, RETURNS-v3-p1]`. The ADK event trace shows the
`search_documents` call and the passage returned to the agent. Ask about a
warranty period; the ingested policy set has no warranty policy, so this
policy chatbot should abstain.

If port 8000 is already in use by an older ADK server, stop that server with
`Ctrl+C` in its original terminal, then start the command above again so it
loads the current Phase 2 code. You can use port 8001 instead by changing both
`--port 8000` and the URL to `http://127.0.0.1:8001`.

## Baseline chat agent

The baseline agent is a separate chat for observing how Codex chooses to use
the read-only policy search tool. It has no application policy instruction.
It can choose not to search, search more than once, or answer. The ADK trace
shows the user message, tool calls and arguments, results, and final answer.
It does not show private model reasoning. The bridge stops a turn if the agent
requests more than 24 tool calls.

Start it from this project directory in PowerShell:

```powershell
uv sync --frozen
./scripts/postgres-start.ps1
uv run adk web --session_service_uri memory:// --artifact_service_uri memory:// baseline_chatbot --host 127.0.0.1 --port 8001 --no-reload
```

Open <http://127.0.0.1:8001> and select `baseline_chatbot`. Type the question
and any test directions you want the agent to try. Inspect the ADK event trace
to see if it searches, which query it sends, what the tool returns, and what
it says next. Search can return passages only from active, ready policy
versions. It cannot read local files or change policy data. The prompt
injection behavior has not been evaluated by the implementation smoke check.

### Langfuse traces

This project can send Google ADK model calls and tool calls to Langfuse. To
enable it, append your project values to the ignored `.env` file. Do not replace
the existing `RAG_DATABASE_URL` line:

```dotenv
LANGFUSE_PUBLIC_KEY=pk-lf-your-project-key
LANGFUSE_SECRET_KEY=sk-lf-your-project-secret
LANGFUSE_BASE_URL=https://cloud.langfuse.com
```

Use the base URL shown for your Langfuse project or deployment. Restart the
ADK server after adding the values. When all three are present, tracing starts
with the chat agent. When all three are empty or absent, the chat runs without
Langfuse. A partial configuration stops startup with a message naming the
missing setting.

Langfuse receives model request/response content and search tool inputs/results.
This includes the user's question and any retrieved policy passages. Use this
only with content you are comfortable sending to the configured Langfuse host.
The model still runs through the signed-in Codex CLI; Langfuse credentials do
not authenticate or power the model.

Press `Ctrl+C` in the chat terminal to stop the server. Stop the isolated
database with `./scripts/postgres-stop.ps1` when finished. Keep this server on
`127.0.0.1`; the local ADK development UI has no user authentication.

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
- Search reads ready passages from each active document version. It uses cosine
  similarity to shortlist at most 20 passages, then reranks them with local
  `ms-marco-MiniLM-L-12-v2` and returns up to five. A fixture-calibrated rerank
  floor of `0.001` provides a no-evidence path; it is an ordering heuristic, not
  a probability. Re-evaluate it as the corpus grows.
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

## Retrieval and chat lab

The retrieval lab adds a read-only question panel to the ingestion lab. It
shows the active corpus, cosine shortlist, reranked order, selected passages,
and the text size returned to the agent. A pending or inactive source selection
does not change which corpus a question searches.

The chat lab runs the existing phase-one or baseline ADK agent through the
signed-in Codex CLI. It records a bounded, redacted event trail in PostgreSQL
and lets you replay completed or interrupted runs after a server restart. ADK
session state stays in memory and does not survive restart; replay does not
resume a conversation. Exact constructed prompts and retrieved passage text
are saved locally and visible in expanded event details. They can contain the
question and policy content, so use only test material you are comfortable
storing in this local database. Langfuse remains optional and may receive model
inputs and search results when configured.

Start the isolated database once, then apply migrations. Run each lab in its
own terminal from the project directory:

```powershell
./scripts/postgres-start.ps1
uv run python -m rag.cli migrate
uv run uvicorn rag.lab_api:app --host 127.0.0.1 --port 8002 --workers 1
```

Open <http://127.0.0.1:8002> for ingestion and retrieval. Start the chat lab in
a second terminal:

```powershell
uv run uvicorn chatbot.lab_api:app --host 127.0.0.1 --port 8003 --workers 1
```

Open <http://127.0.0.1:8003>. This page uses the same local ADK agents and does
not require a separate `adk web` server. Codex CLI must be installed and
signed in. The first retrieval may download the approximately 21.6 MB
FlashRank model archive into ignored `.local/flashrank/`; the embedding model
is also cached locally. Keep both services bound to loopback. Press `Ctrl+C`
in each server terminal to stop it, then run `./scripts/postgres-stop.ps1`
when finished.

Try these comparison questions in the retrieval panel:

1. “How many calendar days after delivery can a customer request a return?”
2. “Can the customer return an opened or damaged device, and what happens if the delivery arrived damaged?”
3. “Which items are excluded from the standard return window?”
4. “Where is the office parking garage?”

The first three have active RETURNS evidence. The last is unrelated and should
return no selected passages, though the lab retains its candidate trail. A
multi-part question can need several low-scoring passages; inspect recall and
precision together instead of reading a rerank score as confidence.

### Chat event and trace scope

The event replay stores user messages, actual constructed model prompts,
available tool names, model actions, ADK function calls and results, detailed
search candidates, final answers, durations where measured, and safe errors.
It does not store private model reasoning or Codex CLI arguments and stderr.
The local event store redacts common credential forms and bounds each JSON
field. Langfuse tracing remains a separate view. Its configured credentials
were verified without displaying them; the local chat session was cross-checked
against Langfuse observations by session ID. A trace link appears only when an
event has a real trace ID.

Validated locally on 2026-10-19: the real Codex-backed returns question
returned 21 calendar days with a `[RETURNS v3, RETURNS-v3-p1]` citation and a
five-passage search event. A real no-tool question returned `4`. After
restarting the chat server, the saved nine-event run replayed while its live
ADK session reported unavailable. The v2 Langfuse Observations API confirmed
the matching session, two model calls, the search tool, and one shared trace
ID. The installed Langfuse SDK's legacy trace-list endpoint returned the
provider's migration response; verification used the supported v2 endpoint.

## Prompt cache and compaction lab

The prompt cache lab is attached to the chat lab server on port `8003`. Start
it from this project directory in PowerShell:

```powershell
uv run uvicorn chatbot.lab_api:app --host 127.0.0.1 --port 8003 --workers 1
```

Open <http://127.0.0.1:8003/static/cache-lab.html> for the scripted experiment
or <http://127.0.0.1:8003/static/cache-explainer.html> for the offline visual
explainer. To enable paid API runs, add `OPENAI_API_KEY` to this project's
ignored `.env` file. Never paste or commit the key. Preflight shows the current
maximum estimate; the lab caps each paid run at `$0.25`. The four modes are
four separately started runs, so running all four could cost up to `$1.00` if
each reaches its cap. Starting a run makes paid provider calls only after you
review preflight and explicitly select **Start paid run**. Without the key,
the UI remains available for inspection, but paid runs are blocked.

The explainer makes no model calls. It starts with illustrative fixture data;
you can import JSON exports from local runs for measured comparisons. Press
`Ctrl+C` in the server terminal to stop the lab.
