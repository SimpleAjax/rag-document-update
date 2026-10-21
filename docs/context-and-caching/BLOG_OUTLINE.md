# Blog outline: We tried to cut our AI agent's cost

This is a **working storyline**, not the article. Write the final headline and numbers after the API experiment. The article uses one synthetic returns-policy support case and the local [cache and compaction lab](../prompt-cache-compaction-lab/DESIGN.md).

## Working headline

**We Tried to Cut Our AI Agent's Cost by 90%. Would Its Answers Hold Up?**

The 90% is an experiment target, not a result. If the measured whole-run saving differs, replace it with the measured number. If savings are small, lead with that finding. The article must say what the percentage compares: total model cost across the same conversation, including checkpoint calls and retries.

## Reader and opening scene

Open in the middle of a support case. A customer asks whether an opened device can be returned after delivery. The agent searches the active policy, answers, and handles follow-up questions about damage, missing accessories, and a policy exception. By the last question, the answer needs only a few facts, yet the model may receive the earlier turns and tool results again.

For an owner or support lead, the stakes are the cost of each resolved case and the risk of a wrong promise to a customer. For a learner, the puzzle is what the model receives on each call and what the provider charges for it. Use the actual synthetic policy and transcript; do not imply this is a live customer case.

## Story arc

| Beat | Question and proof | Reader-facing visual |
|---|---|---|
| **1. The bill grows inside one case** | Show the same conversation at its first and last model call. State what was sent on each call, with measured input tokens once runs exist. Start with the customer outcome and cost per resolved case. | A conversation timeline feeds a growing prompt strip. Click a turn to see the exact active context. |
| **2. A chat is a series of model calls** | Explain that the app assembles effective context for each generation. The existing Codex CLI bridge rebuilds text prompts; the new experiment uses OpenAI Responses API so it can record billed token categories. Avoid a blanket claim that every API or app is stateless. Explain KV work only after the reader sees repeated context. | Animate two calls: shared instructions and earlier turns repeat; the last user question changes. |
| **3. First lever: reuse the beginning** | Show the actual no-cache and cache/full-history runs. On GPT-6 Luna, explicit mode with no breakpoints gives the no-cache control; an explicit breakpoint on a stable developer content block permits prefix caching when eligible. Read provider-reported cached and cache-write tokens. Explain the minimum eligible prefix, exact matching, cache lifetime and write cost. A cache hit reduces priced input work; it does not shorten the prompt. | A prefix match view marks the breakpoint, first divergence, and measured cached-token count for each call. A small edit near the start shows why reuse can vanish. |
| **4. Second lever: carry a checkpoint** | At a settled decision, retain the answer, caveats, unresolved question, policy version, passage IDs, and evidence needed next. Keep the full event history for replay, but send the checkpoint and recent turns as active context. If a later question needs the precise policy wording, refetch the passage. Use the human-memory analogy carefully: remember the conclusion and where to look; reopen the record for exact wording. Show the extra checkpoint call in the bill. | Two lanes show stored history and active context. A refetch arrow restores a cited policy passage to the next request. |
| **5. Put both levers together** | Compare all four actual runs: no cache/full history, cache/full history, no cache/compacted, and cache/compacted. Keep model, questions, policy evidence, output cap, and settings fixed. Show how a changing checkpoint can shorten context but also change a cacheable prefix if placed badly; put stable instructions first and changing case material after the breakpoint. | Four aligned lanes show context size, cached input, cache writes, checkpoint calls, and first divergence. |
| **6. The result, including the catch** | Show per-call and whole-conversation cost, input/output tokens, latency, cache hits, checkpoint overhead, and answer quality. Review whether each answer preserved the return window, exceptions, damage qualifier, source version, and citations. Report failed answers and cache misses, not only the cheapest run. Give sample count and run date. | Interactive cost and answer-quality chart driven by saved run data. Toggle per-call/cumulative and measured/derived. |
| **7. What an owner should take away** | Translate the finding into cost per support case and the conditions under which it might matter at higher volume. Name what this one synthetic case cannot establish. End with the design rule supported by our results, and a practical question: which facts must stay in the next answer, and which can be fetched again? | A compact decision flow: stable prefix, checkpoint boundary, evidence refetch, measure the whole case. |

## Visual plan for the article

Use the lab's exported, reviewed synthetic run data to build one offline interactive HTML explainer with four panels: **context assembly**, **prefix reuse**, **full history versus checkpoint**, and **four-run cost plus answer-quality comparison**. Each panel has a readable static state. Mark every number as *API measured*, *derived from usage and the verified rate card*, *counterfactual*, or *illustrative*. The diagram must show a relationship or a state change; a row of decorative boxes is not enough. One still image from the explainer can serve as the article hero after the results are known.

Keep code examples short and taken from actual repository files. Show the request setting that separates no-cache from cache, the checkpoint shape, and the cost calculation only if those snippets clarify the result. Link to the complete code when it is ready.

## Evidence and claim rules

- The current Codex CLI bridge records prompt characters and events. It cannot establish OpenAI cache hits or API cost. The new Responses API lab supplies the measured token and cache usage for this article.
- The four modes are **actual runs**, not hypothetical price columns. The no-cache modes use explicit caching mode with no breakpoints; verify zero reported cached and cache-write tokens and flag any anomaly.
- Compute whole-run cost from ordinary input, cached input, cache writes, output, checkpoint calls, and retries using rates verified for the run date. A 90% cached-input discount is not a 90% whole-agent saving.
- Report answer quality separately from token economics. A shorter context may omit a qualifier. A correct later answer can require refetching the source.
- The lab measures OpenAI only. A short provider comparison may explain that Anthropic and Gemini also offer context caching under different rules, with citations checked at drafting time. Do not put their prices in the measured chart.
- One synthetic case is a teaching experiment. Describe its limits and avoid general savings claims.

## Sources to check while drafting

- [OpenAI GPT-6 Luna model and pricing](https://developers.openai.com/api/docs/models/gpt-6-luna)
- [OpenAI prompt caching](https://developers.openai.com/api/docs/guides/prompt-caching)
- [OpenAI Responses API request reference](https://developers.openai.com/api/reference/resources/responses/methods/create)
- [Anthropic prompt caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching)
- [Gemini context caching](https://ai.google.dev/gemini-api/docs/generate-content/caching)
