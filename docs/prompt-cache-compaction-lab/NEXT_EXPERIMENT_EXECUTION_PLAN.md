# Next experiment: growing cache and selective tool-result compaction

## Purpose and boundary

Test whether an append-only conversation produces a growing cached prefix, then test whether replacing one completed tool exchange with a short evidence-backed conclusion reduces **total** cost without harming later answers. Build the smallest local experiment that can answer those questions. Follow `CONSTITUTION.md`. This plan is for the next implementation agent; this file does not report a new result.

The first five-turn experiment in `RESULTS.md` cached only the 1,113-token stable developer prefix. `chatbot/cache_lab.py` currently serializes changing history as JSON inside one user message. Each new request rewrites that message, so the run did not test reuse of the growing conversation. The first checkpoint also needed a separate model call. Those are the two things to change in this experiment.

Keep the existing run records and `RESULTS.md` intact. Reuse the Responses adapter, local PostgreSQL event log, rate snapshot, budget gate, export, and loopback API where useful. Do not change the ADK chat, ingestion, or retrieval flows.

## Questions to answer

1. Does provider-reported `cached_tokens` grow when earlier messages are preserved byte for byte and new messages are appended?
2. Is implicit caching or a small set of explicit breakpoints better for this transcript after counting cache-write charges?
3. When one large tool result is no longer needed in every request, does replacing it with a short conclusion save money over the remaining turns?
4. Can the agent still answer a later question that needs an exact qualifier or passage? Does it refetch the stored source when the conclusion is insufficient?

## The four comparison modes

Use the same model, source fixture, scripted questions, output cap, reasoning setting, response format, and tool contract in all modes. Keep the stable instructions and policy source version first. Use separate messages and content blocks for conversation turns and tool results; never put the entire growing history in one rewritten JSON string.

| Mode | History sent | Cache rule | Purpose |
| --- | --- | --- | --- |
| A. Full, no cache | Append-only full history | Explicit mode, no breakpoints | Total-cost baseline |
| B. Full, fixed-prefix cache | Append-only full history | Explicit breakpoint after stable developer content only | Compare with our first experiment |
| C. Full, growing cache | Append-only full history | Implicit latest eligible message, plus stable developer breakpoint if needed | Test growing prefix reuse |
| D. Selective compact + growing cache | Same as C until a completed tool step; later requests use its conclusion in place of the raw tool exchange | Preserve stable breakpoint and eligible boundaries | Test cost and answer quality after compaction |

If explicit breakpoints after tool-result boundaries are useful, test them as one **small diagnostic variation** of C, not another full product mode. OpenAI permits multiple explicit breakpoints, but each request can create up to four cache writes; count those writes. The incoming request must retain the matching breakpoint for an earlier cached boundary. Do not assume a `prompt_cache_key` makes a rewritten prefix reusable. On GPT-6 Luna it can separate run accounting; it does not guarantee a hit.

## Task 1 — freeze the scenario and provider contract

- Verify the current official OpenAI prompt-caching guide, GPT-6 Luna model page, and pricing page immediately before implementation and before paid runs. Record URLs, date, rates, cache minimum, breakpoint/write rules, and usage-field mapping with the run. Do not print the API key.
- Create one deterministic 10–12 turn Northstar policy transcript. Put a realistically large retrieved tool result early, with document/version/passage IDs and at least one qualifier needed by a later question. Mark the point where the tool task is complete and its raw result becomes eligible for compaction.
- Keep the **same scripted user, assistant, and tool history** in the cache-mechanics comparison. Send each call and record its actual response, but use the fixed transcript for the next request so generated wording cannot change the next prompt. For D, use one fixed reviewed conclusion in subsequent scripted prompts; separately record and charge for the conclusion the model actually generates. If the two differ materially, report that and do not treat the scripted continuation as a quality result. Label these runs `fixed transcript / cache mechanics` in storage and UI.
- Define one short separate live continuation after the compaction point to check answers, citations, qualifiers, and refetch. Use the same questions and source facts in both full and compact modes. A human can review the saved answers.
- Acceptance: a local fixture shows the exact message sequence and where the first byte changes between consecutive requests. No paid call is required for this task.

## Task 2 — build correct request shapes

- Add a versioned runner or isolated mode path in `chatbot/cache_lab.py`; keep old modes readable and replayable. Build `input` as ordered messages: stable developer block, earlier user/assistant/tool messages, then the new user message. Preserve old message text, roles, block boundaries, tool definitions, model settings, and ordering exactly in append-only modes.
- For A and B, use explicit-only mode. A has no breakpoints. B has only the stable developer breakpoint. For C and D, use implicit mode with the stable developer breakpoint if needed. Keep cache mode constant within a run.
- Keep a distinct run key for accounting, stable inside that run. Compare the request payloads locally before dispatch and record a hash per message/block plus the longest locally identical prefix. Treat that as an application-side diagnostic; provider `cached_tokens` is the evidence of an actual hit.
- Do not change top-level reasoning effort or `text.format` during the comparison. The earlier checkpoint call changed both and created another prefix. If a structured conclusion is requested, use the same response format consistently across comparable turns or measure its effect explicitly.
- Acceptance: fake-transport checks prove A has zero breakpoints, B cannot write past the developer block, and C/D preserve earlier messages and eligible boundaries. A changed early message must visibly shorten the matching local prefix.

## Task 3 — compact one completed tool step

- Persist the full tool request, returned passages, and original answer in the local event history. After the completed step, prepare one short conclusion containing: resolved question, answer, source document/version/passage IDs, exact exception or deadline, uncertainty, and a `refetch_required` hint. Do not turn a user claim into a policy fact.
- First try to obtain the conclusion in the **same model response** as the normal answer. Count its extra output tokens. Keep the output format stable across comparable calls. If this yields invalid or low-quality conclusions, record that failure; do not silently add a second summarization call. A separate call, if tested, must appear as a distinct paid variant with its cost.
- In D's later prompts, replace only that completed tool exchange with the conclusion. Keep newer turns verbatim and append-only. Show that cache reuse may fall back to the stable prefix or an earlier eligible boundary immediately after the replacement, then can grow again from the compacted version.
- For a later exact-detail question, allow a local refetch by document/version/passage ID. Record the source IDs, returned text, and when the model received it. Count the follow-up model call and any generated tokens. A local database lookup has no OpenAI token charge, but its returned content does when sent to the model.
- Acceptance: replay displays both stored full history and the shorter active prompt; a stale or absent source ID is not represented as verified current evidence.

## Task 4 — measure and conclude

- Reuse the existing per-variant spend cap and preflight. No automatic retry. Run one bounded fixed-transcript pass of A–D, then the short live continuation for answer quality. If a run fails, preserve it with its paid usage; retry only to resolve that concrete failure. Keep the whole exercise small enough to remain well below the user's available credit.
- Save per-call: input, output, cached-input and cache-write tokens; cost by category; duration; breakpoint locations; local identical-prefix length; response ID/status; and whether this call wrote, hit, or missed a cache. Use provider usage for hit/write claims. Missing usage stays `unknown`, not zero.
- Compare **all paid calls**, including any extra conclusion generation, refetch continuation, and failed attempts. Report total cost, cost per turn, total input/output, cache reads/writes, and the turn where compaction pays back its cost, if it does. Do not use a 90% headline unless measured.
- Review live answers against the fixed source: correct policy fact, exact qualifier, correct document/version/passage citation, correct refetch when needed, and unsupported claims. Label the reviewer and sample size. Distinguish `fixed transcript / cache mechanics` from `live continuation / answer quality` in every conclusion.
- Write results in a **new** `NEXT_EXPERIMENT_RESULTS.md` beside this plan. Include run IDs, rate snapshot, exact observations, limitations, and a plain-language conclusion. Leave the first experiment's `RESULTS.md` unchanged.
- Acceptance: another reader can reproduce the cost arithmetic from recorded usage and understand which conclusion is measured versus inferred.

## Task 5 — replace the complex teaching UI with one simple run page

Use the existing `/static/cache-lab.html` entry point. Reduce it to one page with this order:

1. **Run selector and action:** choose a saved run or mode; show model, fixture, date, paid-call cap, preflight, and one `Start run` control. Keep the existing budget gate. No tabs, sliders, separate explainer workflow, or dense chart dashboard.
2. **What went in:** a short readable list of stable instructions/source version, scripted questions, tool-result size and IDs, cache mode/breakpoints, and the point where compaction happened. For a selected step, show the exact messages sent in a plain collapsible detail. Never show credentials.
3. **What happened, step by step:** one vertical history. Each row says `Turn 3 · tool result added`, `Turn 4 · 3,800 cached tokens`, `Turn 6 · tool exchange replaced by conclusion`, or `Turn 7 · passage refetched`, followed by input/cached/write/output tokens and derived call cost when available. Use actual event order. A failed or stopped call stays visible.
4. **Conclusion:** at the top after a run completes, show total cost for each comparable mode, the observed saving or increase, whether cached tokens grew, whether compaction paid back, and whether answer quality held up. Say `Too little evidence` when there is no valid comparison. Include one sentence on sample size and fixed versus live runs.

Remove or hide the current context tabs, ten-column ledger, chart grid, blinded-review form, offline explainer link, and overlapping controls from this experiment's main path. Keep stored raw events and export available through the API; a small `Download JSON` link is enough. No new theme work or browser visual inspection is required. Keep labels and layout in the existing Cimulink style, but favor clear text over decorative panels.

- Acceptance: the user can open one URL, start or select a run, understand its inputs, follow the event history in order, and read the conclusion without opening another page. Replay of an old run makes zero model calls.

## Local implementation order and checks

1. Implement fixture and request-builder changes; inspect two adjacent payloads locally to prove append-only structure.
2. Add selective conclusion, refetch, and event accounting. Run focused fake-provider checks for payloads, usage math, budget stop, and replay.
3. Simplify the existing UI and check its API flow using local route/DOM checks. Leave browser visual judgment to the user.
4. Run bounded paid experiments, review outputs, write the results file, and provide the exact local command and URL. Do not start or stop unrelated servers.

Stop once those checks support a clear conclusion. If the provider reports no growing cache hits, use its cache diagnostics with a recent response ID, fix the concrete request mismatch, and rerun only the affected small case.

## Handoff format

The implementation agent reports: changed files; local checks; paid run IDs and total derived spend; the observed cache-growth result; compact-versus-full total cost; answer-quality finding; and the single UI URL. State any provider fields that were absent and any claim the data cannot support.
