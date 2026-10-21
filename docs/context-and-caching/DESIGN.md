# Context and caching experiment

## Why this experiment

Long chats send the same rules and tool definitions again with a growing conversation. There are two different ways to address that cost:

- **Provider-managed prefix caching** may reuse work for an identical prompt prefix. OpenAI documents that cache matching depends on an exact prefix match and is handled by the provider. Caching does not make the prompt shorter or remove context.
- **Application-owned compaction** makes the prompt shorter by replacing settled conversation history with a checkpoint summary. The application must preserve what later turns need.

These approaches can work together: keep a stable prefix for possible reuse, and compact the changing conversation tail to reduce its size.

## What happens today

The ADK runner keeps the live session in process memory. PostgreSQL stores chat run and event records for replay, but it does not store resumable ADK session state. A session becomes unavailable when its process memory is gone.

Before each model call, `chatbot/codex_model.py` rebuilds one text prompt from the system instruction, available ADK functions, and all text in the current ADK contents, including prior user and assistant messages and tool events. It starts `codex exec --ephemeral` and sends that complete prompt on standard input. Calls do not continue a Codex CLI conversation.

The database event trail retains user messages, tool calls and results, answers, and `model_input` prompt text (bounded to 64,000 characters per JSON field). Retrieval/search events include evidence details such as passage IDs and versions. This is replay history; it is not automatically loaded back into the next prompt after a restart. The prompt contains retrieved evidence only when it is present in the current ADK contents, usually through tool results.

The recorder measures prompt characters and event counts. This bridge does not currently report provider cache-hit tokens, cached-token discounts, or token usage. Do not infer those from character counts.

## Proposed prompt shape

Keep the order and bytes of the reusable prefix steady:

1. Fixed role and safety instructions, including the rule that retrieved text is evidence, not instructions.
2. Stable response and tool-call format.
3. Stable tool definitions, when the available tool set is unchanged.
4. A clear boundary, followed by the changing conversation checkpoint, recent turns, current question, and retrieved evidence.

Put changing content after the stable prefix. Version the instruction and checkpoint format so a deliberate policy change is visible. Reordering fields, changing whitespace, or changing tool schemas can break exact-prefix reuse.

After the user and assistant have reached a clear decision, a checkpoint may replace older conversational detail in the active prompt. Keep the decision, unresolved questions, constraints, policy/document version, passage IDs, and the exact evidence still needed to support the next action. Keep the full event trail for replay. If older evidence is needed again, retrieve it by its passage ID or search again, then include the returned version and passage IDs with the evidence in the prompt.

## Tradeoffs to observe

Compaction lowers prompt characters when the removed history is larger than the checkpoint. It can also omit a qualifier, conflict, or evidence needed to answer correctly. A checkpoint must not turn a disputed or tentative claim into a settled fact. Retain source versions and passage IDs so a later step can re-check the source.

A stable prefix gives provider-managed caching a better chance to match across calls. Any change inside that prefix can reduce reuse. New checkpoint text and newly retrieved evidence change only the tail if they follow the stable boundary. Compaction reduces total context length; caching may reduce repeated provider work for a matching prefix. Neither result is guaranteed in this CLI bridge.

OpenAI's prompt-caching guide describes provider-side caching for supported API requests. Its compaction guide describes Responses API compaction. The current bridge uses ephemeral `codex exec`; those API features and fields such as `prompt_cache_key` are not exposed here. Do not claim cache discounts, cache hits, or server-side compaction from this experiment unless the CLI later exposes verifiable usage data.

## Small experiment

1. Use one repeatable multi-turn task that retrieves a policy passage, reaches a decision, and then asks a follow-up that may need the earlier evidence.
2. Record the current prompt character count and check whether the follow-up still answers correctly with the full history.
3. Repeat with a checkpoint inserted after the decision. Preserve the source version, passage IDs, exact supporting evidence needed, and unresolved points; remove only settled older dialogue and redundant tool chatter.
4. Ask the follow-up. Confirm that the checkpoint supports the answer, and re-retrieve older evidence when the task needs more detail than the checkpoint retained.
5. Compare correctness, omitted evidence, retrieved versions/IDs, and prompt character counts. If the CLI exposes real token/cache usage, record those reported fields separately. Otherwise report only characters and make no token, cache-hit, latency, or cost claim.

This is a design for a later local learning experiment, not a change to the Phase 1 chatbot.

## References

- [OpenAI prompt caching](https://developers.openai.com/api/docs/guides/prompt-caching)
- [OpenAI compaction](https://developers.openai.com/api/docs/guides/compaction)
- Current bridge: `chatbot/codex_model.py`; current session and replay boundary: `chatbot/lab_runtime.py` and `migrations/003_chat_lab.sql`.
