# Execution plan: RAG ingestion lab

**Status:** Implemented locally and acceptance run completed. API-backed browser rendering was verified over HTTP; visual inspection in an interactive browser was unavailable in this environment.
**Design:** [DESIGN.md](./DESIGN.md)
**Owner:** One implementation agent can take these tasks in order.

## Result to deliver

Build a local page that explains a real policy ingestion. A user can start a
live run, step through a run, or replay a saved run. Each view uses saved job
events and real stage output. The page does not call the ADK chat agent.

Keep the first build small. Use the existing ingestion function, local model,
PostgreSQL cluster, and source folder. Keep the server on `127.0.0.1:8002`.
The ADK chat server uses a separate port and remains outside this work.

## Read first

Read these files before code changes:

- [Design](./DESIGN.md)
- [Ingestion](../../rag/ingestion.py)
- [Schema](../../migrations/001_initial_schema.sql)
- [Migration runner](../../rag/database.py)
- [Source parser](../../rag/documents.py)
- [Embedding wrapper](../../rag/embeddings.py)
- [Current CLI](../../rag/cli.py)
- [Existing run guide](../../README.md)

Inspect `git status --short` first. Existing Phase 1 and Phase 2 files may
already be staged or modified. Preserve that state. Add only files needed for
this lab. Do not reset or clean the worktree.

## Build order and acceptance

Do each task in order. Run its local checks before starting the next task.
Record the command, result, and any limit in the final handoff. If a check
fails, fix the cause and rerun that check. Do not claim a browser test from an
API-only test.

### Task 1 — Fix the test boundary and capture current behavior

**Build**

- Make no product change yet.
- Record the current PostgreSQL identity and active `RETURNS` version. Use the
  existing guarded connection helper. Do not print the connection string.
- Record the current v1/v2 source hashes and passage counts.
- Check that unchanged v2 ingestion returns `already_ready` with no new job.
- Note the current event order and the fact that `INDEXING` is before the
  final database transaction.

**Check locally**

- Run `uv sync --frozen` and the existing unit tests.
- Run `uv run python -m rag.cli migrate` twice. Both runs must preserve data.
- Use read-only SQL to confirm the project database on port `55433` and the
  current active version. Never connect to the other local instance on `55432`.

**Done when**

- The agent has a short baseline note in its work log.
- No source, passage, version, or job row changed during this task.

### Task 2 — Add the replay fields and ordered migration runner

**Build**

- Add `migrations/002_ingestion_lab.sql`.
- Add `ingestion_jobs.run_mode TEXT NOT NULL DEFAULT 'CLI'`. Permit `CLI`,
  `LIVE`, and `STEP` values. Old jobs must read as `CLI`.
- Add `ingestion_job_events.payload JSONB NOT NULL DEFAULT '{}'::jsonb`.
- Update `rag/database.py` to apply numbered `*.sql` migrations in order.
  Use `schema_migrations` for the applied set. Keep the database identity
  checks and avoid data deletion.
- Make each migration repeatable. Do not use `DROP TABLE` or a reset command.

**Check locally**

- Apply migration 002 to the isolated project database. Apply migrations
  again. The second run must report no new migration.
- Confirm old job rows remain and show `run_mode = 'CLI'`.
- Confirm old events remain and show an empty JSON payload.
- Run a migration test on a fresh empty test schema or a controlled test
  database if the implementation can keep the project identity guard. Do not
  weaken that guard to make a test pass.

**Done when**

- DBeaver can show the new columns and the old data.
- A repeated migration makes no new schema or data change.

### Task 3 — Save real stage artifacts and clear milestones

**Build**

- Extend `rag/documents.py` only as needed to retain the source text that the
  parser read. Its hash and replay snapshot must describe the same text.
- Add passage position and overlap metadata for the lab. Keep the current
  `split_passages` result for existing callers. Test that the metadata matches
  the actual splitter output.
- Extend `rag/ingestion.py` with a structured milestone callback. Include
  job ID, event sequence, state, and stage payload. Keep the CLI callback
  behavior working.
- Save each event and its payload in one transaction. Save full passage text
  after chunking. Save the full 384-value vectors after embedding.
- Record model name, vector dimension, actual elapsed embedding time, and
  planned passage IDs. Use a monotonic clock for durations.
- Save the old active version before indexing. Save committed passage IDs and
  the new active version in the same transaction as `READY`.
- Call the milestone hook after that event transaction commits. Never call it
  from inside an open transaction.
- Start step pauses after `VALIDATING`. `PENDING` records job creation after
  source parsing; it is not a work stage. Do not pause after `READY` or
  `FAILED`.
- Keep an exact, narrow advisory lock for a document across a run. Both CLI
  and lab runs use it. Release the lock on success, failure, and interruption.
- Do not make a second ingestion algorithm for the lab.

**Check locally**

- Unit test the event order and the payload shapes with a stub embedding
  function. Check all vectors have 384 finite values.
- Test a forced embedding error. It must leave the old active version in
  place and save `FAILED` with the earlier artifacts.
- Test a forced indexing error. It must leave no partial passage set and no
  new active pointer.
- Test a second attempt for the same document while a first attempt holds
  its lock. The second attempt must return a clear busy result.
- Re-run the existing CLI and document tests.

**Done when**

- A job can be explained from its saved events alone.
- The final passage rows and `READY` agree with the active pointer.

### Task 4 — Add the local run controller

**Build**

- Add a small controller module, for example `rag/lab_controller.py`.
- Start ingestion in one worker thread so an HTTP request can return at once.
- Support `LIVE` and `STEP` with the same ingestion function.
- In step mode, wait after each committed nonterminal milestone. Use a
  `threading.Event` or `Condition`. Keep no transaction open during a wait.
- Give each browser run a temporary run ID. Link it to the stable database
  job ID as soon as the job exists.
- Store only the active control state in memory: mode, job ID, wait sequence,
  and stop request. Keep the event history in PostgreSQL.
- Allow one active lab run. Return `409` for another start.
- Require the current event sequence when a user clicks Continue. Reject a
  stale request, a duplicate click, or a click on a live run.
- Add a Stop run action. Stop at a stage boundary, record `FAILED` with a
  safe user-stop detail, and release the document lock.
- On server shutdown or next start, mark only unfinished lab jobs as failed.
  Preserve their events. Do not change old CLI jobs.
- If parsing fails before a job starts, return a clear validation error.
  Do not invent a database job for it.

**Check locally**

- With a stub ingester, prove that STEP pauses at `VALIDATING`, `CHUNKING`,
  `EMBEDDING`, and `INDEXING` in that order.
- Prove that one Continue releases one wait point.
- Prove that LIVE never waits for Continue.
- Prove that Stop, server shutdown, and a worker error unblock the worker.
- Prove that a browser refresh can read the same active run state.

**Done when**

- Pausing does not depend on the browser tab staying open.
- No request thread waits for the embedding model or for a user click.

### Task 5 — Add the local API

**Build**

- Add a small FastAPI app, for example `rag/lab_api.py`.
- Add FastAPI and Uvicorn as direct, pinned dependencies in `pyproject.toml`.
  Update `uv.lock`. Use one server worker for the in-memory controller.
- Implement the six endpoints in the design, plus `POST /api/runs/{id}/stop`.
- List source files from `data/policies/`. Accept only a selected relative
  Markdown path from that folder. Set a clear lab file-size limit.
- Return job data from PostgreSQL in event sequence order. Include the real
  payload and timestamps. Never return the database URL or environment data.
- Distinguish an already-ready file from a new run. It must not show a fake
  timeline or claim that embedding ran again.
- Bind the documented command to `127.0.0.1:8002`.

**Check locally**

- Test the source list, start, poll, Continue, Stop, job list, and replay APIs.
- Test invalid paths, missing files, oversized files, duplicate starts, and
  stale Continue calls. Check status codes and safe response bodies.
- Confirm the API never returns credentials or a local Codex auth path.

**Done when**

- API responses contain enough data to render the lab without reading files
  or database tables directly in the browser.

### Task 6 — Build the page and its teaching views

**Build**

- Add one local HTML/CSS/JavaScript page served by the lab app. Keep it usable
  on a laptop screen. It does not need a frontend build tool.
- Show a source picker, Live and Step mode choice, Start, Continue, and Stop.
- Put the temporary run ID in the page URL. A refresh must reopen the active
  run through `GET /api/runs/{run_id}`.
- Show a timeline with state, timestamp, duration when known, and result.
- Add the source, validation, chunk, embedding, indexing, and activation
  detail views from the design. Use the event payload as the source of truth.
- Show each full passage with its planned and stored ID. Show the configured
  chunk limit and overlap. Draw an overlap only where the splitter used one.
- Show the first 16 vector values, an expandable full list, a value heatmap,
  and a cosine similarity matrix. Calculate the matrix from real vectors.
- Label the matrix as a comparison, not a policy quality score.
- Add replay controls that move between saved events without starting work.
- Show live, paused, failed, ready, and replay labels clearly. On a rapid live
  run, keep every saved event available in the timeline.
- Give the page a clear empty state and an accessible text description for
  each chart. Do not make color the only carrier of meaning.

**Check locally**

- Inspect the page in a browser at laptop width and a narrow width.
- Verify Step buttons and keyboard focus. Verify the page after refresh.
- Compare passage text, vector count, event time, and active version with
  database rows. A visual value must match its stored value.
- Confirm replay never calls the ingestion start API.

**Done when**

- A reader can explain one source-to-active-version run from the page alone.

### Task 7 — Prepare a useful demo and run local acceptance

**Build**

- Add a new synthetic `data/policies/RETURNS-v3.md`. Make it longer than v2.
  Target at least four passages with the current splitter. Keep the facts
  clear and consistent. State in the README that ingestion activates v3.
- Keep v3 un-ingested for the user's first live or step demonstration.
- For agent-side end-to-end validation, use a separate synthetic test source.
  Give it a distinct document ID and record its rows. Do not silently delete
  it or alter v1/v2/v3. If a test source would affect the chat corpus, state
  that limit in the handoff.
- Add README commands for starting the PostgreSQL cluster, applying the new
  migration, starting the lab, opening port 8002, and stopping the lab.
- Add a short walk-through for Live, Step, and Replay.

**Check locally**

- In a real lab run with the local model and isolated PostgreSQL, inspect the
  source snapshot, at least four chunks, 384 values per chunk, and the saved
  job trail. Use the separate test source for this check.
- Pause after `EMBEDDING`. Verify the test document is not active yet.
- Pause after `INDEXING`. Verify its passage rows are not committed yet.
- Continue to `READY`. Verify all passage rows and the active pointer exist.
- Replay the finished job. Verify replay makes no new job or passage rows.
- Run an already-ready source. Verify the page explains the no-op.
- Force one safe failure. Verify the previous active version remains active.
- Run `uv lock --check`, `uv sync --frozen`, project unit tests, compilation,
  and `git diff --check`.
- Confirm `.env`, `.local`, model files, and database data remain ignored.

**Done when**

- The page and PostgreSQL show the same facts for a real test run.
- `RETURNS v3` remains ready for the user's first full demonstration.
- The final handoff lists the exact checks performed and their limits.

## Suggested local commands for the finished feature

These commands describe the target workflow. The implementation agent must
verify them before adding them to the README.

```powershell
uv sync --frozen
./scripts/postgres-start.ps1
uv run python -m rag.cli migrate
uv run uvicorn rag.lab_api:app --host 127.0.0.1 --port 8002 --workers 1
```

Open `http://127.0.0.1:8002`. Stop the lab with `Ctrl+C` in its terminal.
Stop the project PostgreSQL cluster with `./scripts/postgres-stop.ps1` when
the user is finished.

## Exit gate

The work is complete when the user can inspect real source text, passages,
vectors, database writes, and version activation. Live mode runs without
pauses. Step mode stops after each saved stage and advances one stage per
Continue. Replay uses saved data and causes no new ingestion. A failed or
stopped job leaves the prior active version in place.

Do not claim that this lab tests the chat agent or prompt injection. Those are
separate project tasks.


## Execution handoff

Implementation is complete in this project. The detailed build requirements
above describe the delivered design and its intended boundaries. Local checks
completed:

- `uv lock --check`, `uv run python -m compileall -q chatbot rag tests`,
  `uv run python -m unittest discover -s tests -v` (4 tests passed), and
  `git diff --check`.
- The ordered migration was applied repeatedly to the isolated
  `rag_document_update` database on port `55433`.
- HTTP checks returned 200 for the page, CSS, JavaScript, approved Cimulink
  marks, source list, and saved job list. After the initial acceptance run, a
  floating saved light/dark toggle and explicit current/upcoming timeline
  states were added; the updated assets also returned 200.
- A real local model Step run paused at `VALIDATING`, `CHUNKING`, `EMBEDDING`,
  and `INDEXING`, then reached `READY`; the saved job replayed its six events.
- A separate shipping test was stopped at `VALIDATING`. Its retry in Live mode
  reached `READY` and activated `SHIPPING v2`.
- `RETURNS-v3.md` remains un-ingested for the first walkthrough. `RETURNS v2`
  remains the active returns version.

The HTTP/API and database checks establish the page assets and run behavior.
An interactive screenshot review at laptop and narrow widths was not possible
because no browser surface was available. The UI includes responsive layout,
keyboard focus, reduced-motion handling, and chart text descriptions, but those
were not visually inspected in a browser here. The specific fault-injection
cases for embedding and final indexing, invalid-path response matrix, server
shutdown interruption, and automated visual rendering were not all exercised
as separate acceptance tests.

To start the finished lab, follow the [README walkthrough](../../README.md#rag-ingestion-lab).
