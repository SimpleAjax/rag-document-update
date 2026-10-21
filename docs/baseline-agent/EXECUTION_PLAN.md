# Execution plan: baseline chat agent

**Status:** Implemented locally and checked with stub and signed-in Codex runs.
**Design:** [DESIGN.md](./DESIGN.md)
**Owner:** One implementation agent can take these tasks in order.

## Result to deliver

Add a separate local ADK agent for open-ended chat tests. It has one tool,
`search_documents`, and no application policy instruction. The agent chooses
whether to search, may search again after a result, and writes its own answer.
The tester supplies all questions and any experimental directions in chat.
Show each visible action and tool result in ADK's existing event trace.

Do not add a sample user task as an agent instruction. Do not build an attack
fixture or run a prompt-injection experiment for the tester. Do not alter the
ingestion lab or the current policy chatbot's behavior.

## Read first

- [Design](./DESIGN.md)
- [Current agent](../../chatbot/agent.py)
- [Current trusted instructions](../../chatbot/trusted_instructions.md)
- [Codex CLI bridge](../../chatbot/codex_model.py)
- [Search tool](../../rag/search.py)
- [Run guide](../../README.md)

Run `git status --short` from the project directory before editing. Existing
project files may already be staged. Preserve that state. Do not reset or
clean the worktree. Use the current isolated project database on
`127.0.0.1:55433`; do not use another local PostgreSQL instance.

## Build order and local checks

Complete each task and its checks before the next task. Record the command,
result, and any limit in the final handoff. A stub check proves the adapter
contract; only a live chat run proves the Codex CLI and ADK integration.

### Task 1 — Record the current path

**Build**

- Make no code change yet. Record the current agent instruction source, its
  registered tools, and the bridge sentence that tells the model to answer
  after a tool result.
- Record how to start the current ADK chat and where its function call and
  function response appear in the development trace.
- Check the project database identity and current active policy version with
  read-only queries. Do not print the connection string.

**Check locally**

- Run the existing Python checks with `uv run python -m unittest discover -s tests`.
- Run one current-chat search if the local CLI and database are available.
  Record only observed events. Do not treat this as a baseline run.

**Done when**

- The implementer can name the exact code path to change and can separate
  current behavior from the new baseline behavior.

### Task 2 — Add a chat-only prompt mode to the bridge

**Build**

- Add an explicit mode to `CodexCliModel`. Keep the existing mode as the
  default so `chatbot/agent.py` behaves as before.
- In the new mode, send ordered conversation messages, prior tool calls,
  function results, and available ADK function declarations to Codex.
- Retain only the technical JSON action contract: return a message or one
  declared tool call per model decision. Remove the current “answer after a
  result” direction in this mode. Do not add a policy or citation instruction.
- Reject malformed actions, unknown tools, and invalid argument objects with
  clear errors. Keep Codex CLI in the current ephemeral, read-only workspace
  with shell, apps, and subagents disabled.
- Add a transparent high cycle limit for a stuck tool loop. An exhausted run
  must report a visible error, not an invented answer. Keep the limit out of
  normal agent decision making.

**Check locally**

- Use a stub Codex process or stub bridge output to test four sequences: final
  answer with no tool call; one search then answer; two searches then answer;
  malformed or unavailable tool call.
- Inspect the built prompt for chat-only mode. It must contain no trusted
  policy block and no directive to search, cite, refuse, or obey/ignore a
  retrieved passage. It must retain speaker and tool-result boundaries.
- Confirm the existing mode still includes its current instructions and
  response behavior.

**Done when**

- The bridge supports repeated ADK tool decisions without changing the
  existing policy chatbot.

### Task 3 — Register a separate baseline ADK agent

**Build**

- Add `baseline_chatbot/` with a `root_agent` that uses the chat-only
  `CodexCliModel` and registers only `search_documents`.
- Leave its application instruction empty. Give it a neutral name and
  description for the ADK development UI; do not put behavior rules in the
  description.
- Reuse `rag.search.search_documents` directly. Do not make a second search
  path or change its active-version filter, result limit, or threshold.

**Check locally**

- Import the new agent and inspect its tool list and instruction field.
- Verify the original `chatbot.root_agent` still imports with its original
  instruction file and tool list.
- Run the Python unit checks again.

**Done when**

- Both agents can be selected or run separately, and only the baseline uses
  chat-only mode.

### Task 4 — Verify the visible action loop locally

**Build**

- Use ADK's existing local development view. Do not create a second chat UI.
- If the trace hides a needed function argument or result, make the smallest
  trace configuration or event-format fix. Do not record hidden reasoning.
- Add exact PowerShell start and stop commands to the README. Keep the server
  bound to `127.0.0.1`; choose a free local port so the ingestion lab can stay
  on `8002`.

**Check locally**

- Confirm `codex login status` works, start the isolated project PostgreSQL
  cluster, and confirm a ready active policy exists. Do not ingest a new
  version solely for this check.
- Start the baseline ADK app. Enter a neutral question chosen at test time.
  Confirm that the trace records the actual user message, each model action,
  tool name and arguments, full returned passage metadata/text, and final
  answer. Record whether the agent chose zero, one, or more searches; do not
  require a specific count for this free-choice run.
- Run one stub-driven multi-call sequence through ADK to prove that two tool
  calls can happen in one user turn even if the live model chose fewer.
- Start the original policy chatbot and confirm that it still loads its
  trusted instructions and can call search. Check that the ingestion lab is
  unchanged.
- Stop the chat server cleanly. Confirm no credentials, Codex temporary
  output, or chat transcript were added to tracked files.

**Done when**

- The local user can ask any question in the baseline chat and inspect the
  complete visible action trail. A repeated tool call is technically possible
  and verified. The existing chatbot still works.

### Task 5 — Handoff for user-led experiments

**Build**

- Add a short README section that states the baseline's exact limits: one
  read-only search tool, active-ready corpus only, no application policy
  instruction, and no access to private model reasoning.
- Explain how to copy the visible trace and record the active document version
  before a run. Let the user choose the question and any later test content.

**Check locally**

- Follow the README from a new PowerShell terminal. Verify the command loads
  the baseline agent, not the policy chatbot.
- Run `git diff --check` and review the exact changed paths. If the project
  files were already staged, report both staged and unstaged changes without
  changing unrelated staging.

**Done when**

- The user has a working local baseline and enough trace detail to conduct
  their own comparisons. No prompt-injection outcome is claimed yet.

## Completion gate

The phase is complete after a real Codex CLI-backed chat turn runs through the
separate baseline agent, the ADK trace shows its actual search calls and
results, a stub check proves a repeated search loop, and the original policy
chatbot remains functional. Report implementation, local checks, and the
user-led experiment as separate facts.

## Implementation results

- [x] Task 1 — Recorded the current bridge and active corpus before changes.
- [x] Task 2 — Added chat-only prompt mode, action validation, and a 24-tool-call per-turn limit. The default trusted mode is unchanged.
- [x] Task 3 — Added `baseline_chatbot/agent.py` with an empty instruction and only `search_documents`.
- [x] Task 4 — Stub ADK run completed two searches and an answer. A signed-in Codex run searched active `RETURNS v3`, received three passages, and answered with the 21-day window. ADK web returned 200 and `/list-apps` listed `baseline_chatbot`. The original policy chatbot also completed a live search and cited the v3 passages.
- [x] Task 5 — Added baseline startup, stop, behavior, and scope notes to the README.
- [x] Optional Langfuse integration — Added the Langfuse SDK and Google ADK
  OpenTelemetry instrumentor. Both chat agents enable tracing when all three
  Langfuse settings exist in the project `.env`; with no settings, tracing is
  off. Unit tests explicitly disable export. No credentials were written.
- [ ] Langfuse account verification — Pending the user adding credentials to
  the ignored `.env`. After that, run a chat turn and confirm a trace appears
  in the configured Langfuse project.

Checks run:

- `uv run python -m unittest discover -s tests -v` — 8 tests passed after the ADK identity metadata adjustment.
- Baseline and original chatbot imports — passed; each uses its intended prompt mode.
- Project database identity — `rag_document_update` on `127.0.0.1:55433`; active versions were `RETURNS v3` and `SHIPPING v2`.
- ADK web HTTP check — `/dev-ui/` returned 200; `/list-apps` returned `["baseline_chatbot"]`.
- Langfuse code path — Covered by mocked configuration tests; remote export and
  trace appearance are not verified until credentials are configured.
- The prompt injection experiment remains for the user to run. The live smoke question above was only an implementation check.
