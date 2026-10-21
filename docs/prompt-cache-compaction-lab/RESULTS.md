# First measured cache and compaction comparison

Run date: 2026-10-19. Model: OpenAI `gpt-6-luna` via Responses API. Scenario: five scripted questions using the active Northstar `RETURNS v3` and `SHIPPING v2` policy snapshots. The four completed runs used the same questions, policy sources, model, reasoning setting, and 500-token answer cap. Each mode generated its own answers; their later prompt histories and output lengths therefore differ slightly.

Costs below are **derived from provider-reported usage** using the verified rate snapshot in each run. They are estimates of API charges, not an invoice. The local PostgreSQL events retain each request, response, usage object, and answer. Four JSON exports are in ignored `.local/cache-lab-exports/` for the offline explainer.

| Mode | Run ID | API calls | Input tokens | Cached input | Cache writes | Output tokens | Derived cost | Change vs no cache/full |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| No cache, full history | `52d5f027-070c-46fb-a12b-6df06740bc9a` | 5 | 9,326 | 0 | 0 | 1,106 | $0.0014856 | baseline |
| Cache, full history | `f6fe080b-7e7d-4be9-9090-a7075f2c27e7` | 5 | 9,596 | 4,452 | 1,113 | 987 | $0.001080245 | 27.3% lower |
| No cache, compacted history | `7fb973b3-1d42-4559-a4ea-1528378128d2` | 6 | 11,140 | 0 | 0 | 1,296 | $0.001762 | 18.6% higher |
| Cache, compacted history | `16ce22a4-676e-4fe9-a690-96cae89c561c` | 6 | 11,110 | 4,452 | 2,359 | 1,141 | $0.001339795 | 9.8% lower |

## What the calls show

- Both no-cache runs reported zero cached input and zero cache-write tokens on every call.
- The cached/full run wrote a 1,113-token prefix on its first call, then read that prefix on the next four calls.
- The cached/compacted run used its own cache key. It wrote 1,113 tokens on its first answer call and read 1,113 on four later answer calls. Its checkpoint-generation call wrote a separate 1,246-token prefix because that call changed its output format and reasoning setting.
- In the no-cache runs, the three answer calls after the checkpoint boundary used 5,684 input tokens with compaction versus 6,069 with full history, a saving of 385 tokens. Creating the checkpoint added a model call with 2,066 input tokens, so total input rose across this short conversation.
- The four completed runs together cost about **$0.005668** by the local calculation. Two earlier checkpoint attempts were retained as `INVALID` and `STOPPED` after their output was truncated; they consumed about **$0.002667** more. Total derived spend for all API calls in this experiment session was about **$0.008335**.

## Answer check and limits

A read-through of the twenty completed answers found the main policy facts intact: 21-day standard return window, three-day visible-parcel-damage report, seven-day damaged-delivery report, conditional refund timing, and no promised replacement. The compacted/no-cache fourth answer cited the returns section heading instead of a passage ID for one claim. This is a preliminary agent read-through, **not a completed human quality review**; the lab has a rubric for that review.

This is one short synthetic case with one run per mode. Model answers were generated independently, so output tokens and later history lengths vary. Network timing, cache placement, and answer variation can affect per-run totals. These numbers support a narrow finding: in this five-turn case, prefix caching lowered cost, while checkpoint creation outweighed the input saved by compaction. They do not support a 90% whole-agent saving or a general answer-quality claim.

For a stronger article claim, run a longer fixed transcript with the same assistant history across modes, repeat each condition, and have a human score the answers. Count checkpoint calls and retries in every comparison.
