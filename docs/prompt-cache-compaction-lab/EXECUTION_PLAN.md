# Execution plan: API prompt caching and context compaction lab

This plan builds only the local learning prototype defined in `DESIGN.md`. Keep tasks small and demoable. Use the existing local PostgreSQL cluster and loopback services. Do not run paid API calls during implementation or validation. The user performs the first paid run after reviewing the complete local UI and budget controls. Agent validation is limited to code, schema, stubbed-provider paths, and API contract fixtures; no browser visual testing is assigned.

## Phase 0 — source and contract preparation

**Task 0.1: Confirm provider contract and rate card**

- Read the linked gpt-6-luna and prompt-caching documentation immediately before implementation and again before the user runs the paid experiment.
- Confirm Responses API request shape, model identifier, usage fields including cached and cache-write accounting, output cap parameter, and explicit prompt caching semantics. For GPT-5.6+ confirm explicit mode with no breakpoints disables cache reads and writes, while breakpoints opt in; confirm breakpoints belong on developer content blocks and require at least 1,024 visible prefix tokens. Verify category pricing.
- Record official source URL, verification timestamp, rate card, and accounting formula in a local checked-in fixture or UI metadata. Mark the rates as requiring re-verification before paid use.
- Acceptance: the app can display a traceable rate snapshot and refuses a paid run if required accounting fields or rates are unverified/stale according to the chosen validity window. Missing optional usage fields stay null.
- Dependency: none. No API request.

**Task 0.2: Define deterministic scenario and quality rubric**

- Select fixed synthetic returns-policy passage(s), versions, IDs, decision checkpoint point, questions, expected answer facts, qualifiers, and a case where a later question may require refetch.
- Define a short reviewer rubric: correct answer; correct citation/version; preserved exception/qualifier; correct abstention/refetch behavior; no unsupported claims.
- Acceptance: fixture can drive all variants identically and a reviewer can evaluate outputs without seeing the mode label.
- Dependency: current local policy fixtures and retrieval APIs.

## Phase 1 — isolated API runner and cost guard

**Task 1.1: Add Responses API adapter**

- Create a small dedicated adapter module for API calls; keep `chatbot/codex_model.py` and ADK agents unchanged.
- Read `OPENAI_API_KEY` from ignored `.env` via existing environment loading. Never return, log, persist, or render it. Missing key is a clear preflight failure.
- Use only the selected Luna API model and fixed settings from the experiment. Enforce the response output-token cap on every call. Capture request timing, response ID, finish status, raw documented usage, and safe error class/message.
- No implicit paid retries. A retry must be a separate user-initiated attempt and event.
- Acceptance: mock transport verifies request construction, output cap, usage parsing, redaction, errors, and no retry. Live API remains uncalled.
- Dependency: Task 0.1.

**Task 1.2: Add conservative spend estimator and hard budget gate**

- Estimate worst-case cost for every planned answer/checkpoint/refetch call, one explicitly allowed retry, output cap, and all variants. Use verified current rate snapshot and conservative tokenization margin.
- Reserve maximum possible next-call cost before dispatch; reconcile actual usage after response; stop if actual plus reserved maximum next call exceeds `$0.25`.
- Show planned maximum, estimate assumptions, remaining budget, and exact stop reason. Require explicit paid-run start action in UI.
- Acceptance: unit-level deterministic scenarios prove no dispatch when missing/stale rate card, missing key, over budget, or insufficient reserve; no path automatically retries.
- Dependency: 1.1 and 0.1.

## Phase 2 — persistence and replay

**Task 2.1: Add experiment tables and migration**

- Add namespaced experiment, variant, and event tables from the design. Leave migrations 001–003 and existing replay semantics unchanged.
- Store prompt snapshots and policy evidence only in bounded local JSON/text fields. Store usage raw, missing token fields as null, rate snapshot, model/settings, prompt hashes, provider response IDs, duration, status, budget decisions, checkpoint, and quality review.
- Reuse redaction and size-bound patterns from `chatbot/event_recorder.py`. Add explicit filters/tests for key and authorization header patterns.
- Acceptance: migration applies twice; existing chat/replay routes work; experiment replay is read-only and provider-free; failed and interrupted calls remain visible.
- Dependency: schema review against existing `migrations/003_chat_lab.sql` and recorder.

**Task 2.2: Add experiment service and deterministic replay API**

- Create experiment/variant lifecycle, shared scripted turn driver, event append, list/detail/replay, and export endpoints. Replay/export must not instantiate the API adapter.
- Store source events immutably. Represent checkpoint as a derived event and active-context reference, never as a history replacement.
- Acceptance: a stubbed run with a simulated interruption replays all events after restart and reports live session unavailable; replay performs zero provider calls.
- Dependency: 2.1, 1.1.

## Phase 3 — context strategies and request assembly

**Task 3.1: Implement shared prefix and mode strategies**

- Define versioned shared prefix sections and deterministic serialization. Keep the complete stable instruction/tool prefix first, then the explicit boundary, then changing material.
- Implement the actual 2×2 variants: explicit no-cache/full-history (no breakpoints); explicit cache/full-history (stable developer-block breakpoint); explicit no-cache/compacted (no breakpoints); explicit cache/compacted (same stable breakpoint). Keep all other scenario/model/settings constant. Verify cached and cache-write tokens equal zero for no-cache calls and flag any anomaly.
- Use a documented breakpoint on a developer content block, after the stable prefix. Require at least 1,024 visible tokens before the breakpoint; do not pad with irrelevant content solely to reach the threshold.
- Acceptance: golden serialization fixtures verify identical shared bytes for eligible calls and first divergence in tails. Contract checks assert no unsupported cache-disable field is sent.
- Dependency: Task 0.2 and 1.1.

**Task 3.2: Implement checkpoint and evidence refetch**

- At the fixed decision boundary, generate a bounded checkpoint call under the same model/settings and budget controls, or use a deterministic fixture checkpoint for initial UI development. Production experiment mode must record checkpoint generation cost.
- Require checkpoint fields for decision, uncertainty, unresolved question, constraints, source version/passages, exact qualifier to retain, and refetch need. Preserve source events in all cases.
- On later evidence request, fetch by passage ID/query via the existing local retrieval service; record returned document/version/passage IDs and content before the next model request.
- Acceptance: test a missing qualifier causes refetch; wrong/stale version is visible and cannot be silently treated as current evidence. All checkpoint and refetch calls/events count toward cost and latency.
- Dependency: 2.2, 3.1, 0.2.

## Phase 4 — local chat UI and teaching views

**Task 4.1: Add API experiment chat surface**

- Add a clearly separate paid API experiment view to the current lab or a dedicated route. Keep existing chat controls intact.
- Add mode dropdown, scenario/fixture details, API/model badge, explicit budget preflight and start action, output cap, run state, and safe errors. Label actual no-cache variants and actual cache variants clearly; show any no-cache usage anomaly. A counterfactual uncached-price view is supplementary only.
- Render same scripted conversation for each mode with answers, citations, evidence and refetch results. Runs are separate variants with immutable event history.
- Acceptance: endpoint-level and component checks cover invalid mode, missing key, no start without acknowledgment, budget stop, interruption, completed run, and replay without provider access. No browser visual analysis.
- Dependency: 2.2 and 3.1/3.2.

**Task 4.2: Add step-by-step context and checkpoint inspector**

- Display each call's ordered prompt sections, exact local shared prefix, first local divergence, hashes, checkpoint content/provenance, omitted history and refetched material.
- Keep full event timeline accessible beside active model context. Show measured token values only when reported; character counts are supplementary and never described as token counts.
- Acceptance: fixture walkthrough exposes which content is active, preserved, omitted, and refetched, and identifies provider matching as opaque/provider-controlled.
- Dependency: 4.1 and 3.1/3.2.

**Task 4.3: Add cost, latency, quality, and export comparison**

- Show per-call and cumulative variant ledgers with checkpoint and retry rows. Separate observed cache accounting, derived cost, uncached-price counterfactual, and estimates.
- Add anonymized/hidden-mode quality rubric entry and four-mode comparison chart. Record sample count and run date. Include CSV/JSON export with no credentials.
- Acceptance: deterministic fixture checks totals sum across all calls; null usage never renders as zero; quality and provider metrics remain separate; export/reimport preserves provenance and excludes secrets.
- Dependency: 2.2, 1.2, 4.1.

## Phase 5 — shareable blog explainer artifact

**Task 5.1: Build offline interactive diagram page from saved runs**

- Create a static local artifact/data format that consumes exported sanitized run data and makes no provider calls.
- Implement four panels from the design: context sequence; exact local prefix/first divergence; full history/checkpoint/refetch; four-mode measured cost and quality comparison.
- Include accessible text/static fallback, controls, source/rate snapshot, run date/sample count, and labels for measured, derived, counterfactual, and illustrative values.
- Acceptance: fixture data populates every panel; no embedded key or live API call; labels remain visible in static fallback; exported sample data can be replaced with reviewed real runs.
- Dependency: 4.2, 4.3.

## Phase 6 — local validation and handoff

**Task 6.1: Local code/schema validation only**

- Apply new migration to the isolated local database; verify idempotence and preservation of existing chat runs.
- Run focused adapter/parser/budget/strategy/replay/export checks using a fake Responses transport. Verify no outbound API request by inspecting the injected transport boundary.
- Exercise the service's local route flow with synthetic fixtures, including a hard stop and replay after process restart. Do not use the browser for visual QA.
- Acceptance: logs/output contain no key value, replay/export makes no model call, current API lab starts on its documented loopback port, and all current ADK/Codex paths remain unchanged.
- Dependency: all implementation tasks.

**Task 6.2: User paid-run handoff**

- Provide exact local start commands and URL; state that the first model invocation is paid and user-triggered. Show current verified rate card, scenario, output cap, preflight maximum, and `$0.25` cap in the reviewable UI.
- User starts the run. Afterward, inspect saved per-call usage and compare modes before making any quantitative article claim. Re-verify current pricing/docs immediately before run.
- Acceptance: no paid calls are performed by the implementation agent; user can review and initiate one bounded experiment; all run events and quality reviews can be replayed locally.
- Dependency: 6.1.

## Explicit limits

- Explicit cache settings control cache participation for this model family, while actual usage remains provider-reported. A breakpoint does not guarantee a hit or savings.
- API usage fields may be absent or change; null stays unknown until documented and confirmed.
- A single scripted case teaches mechanics but does not establish broad quality or savings. Use additional cases and samples only after reviewing this initial experiment.
- Local prompt/event storage is sensitive even with synthetic fixtures. The service stays on loopback and does not publish records automatically.
- Do not add production auth, multi-user access, distributed workers, or broad benchmark infrastructure in this phase.

