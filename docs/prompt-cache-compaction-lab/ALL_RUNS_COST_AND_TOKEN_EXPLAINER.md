# What all our prompt-cache and compaction runs actually cost

**Data date:** 19 October 2026. **Model:** `gpt-6-luna` through the Responses API. **Source:** provider usage saved in the local `cache_lab_events` table for all 22 variants, plus the two earlier result notes in this folder. The dollar amounts below are calculated from token usage and the rate snapshot; they are **not an OpenAI invoice**. No new model calls were made to prepare this document.

## The short answer

- **Caching worked.** With five turns and a fixed prefix, the complete cached run cost **27.3% less** than its no-cache pair. In a ten-turn fixed-prefix pair, it cost **22.3% less**. In the later growing-cache run, reported cached tokens rose from **0 on turn 1 to 2,953 on turn 10**.
- **Compaction did not lower the ten-turn total.** It removed **7,839 input tokens (30.3%)**, yet the compacted run cost **$0.00001304 (0.57%) more** than the matched growing-cache run. Most removed tokens would already have been cheap cache reads; the compacted run generated more output tokens.
- **The two-question live follow-up favored compaction:** $0.0004638 versus $0.0007035, or **34.1% less**. This is a useful example, not a stable savings estimate. It had only one run per mode and different generated responses.
- **We did not observe a 90% reduction in whole-agent cost.** The 90% figure describes the discount for an individual cached **input** token at these rates. Answers, new input, and cache writes still cost money.

## How to read a token bill

The rate snapshot used in these runs was: ordinary input **$0.10**, cached input **$0.01**, cache write **$0.125**, and output **$0.50**, each per **1 million tokens**. These rates matched the [OpenAI pricing page](https://developers.openai.com/api/docs/pricing) when checked for this explanation. OpenAI's [prompt-caching guide](https://developers.openai.com/api/docs/guides/prompt-caching) explains that cached reads and cache writes are categories *inside* input tokens; a cache write is not an extra fee added on top of an ordinary input charge.

```text
ordinary input = total input - cached input - cache writes

estimated cost = (
  ordinary input × $0.10
  + cached input × $0.01
  + cache writes × $0.125
  + output × $0.50
) / 1,000,000
```

For example, the complete ten-turn **growing-cache** run had 25,864 input tokens. Of those, 22,618 were cache reads and 3,216 were cache writes. Only **30** were ordinary input tokens. Its calculation was:

```text
(30 × $0.10 + 22,618 × $0.01 + 3,216 × $0.125
 + 3,341 × $0.50) / 1,000,000
= $0.002301680
```

The output alone cost **$0.0016705**, about **73% of that run's total**. This is why a 90% cheaper cached *input* token did not make the whole conversation 90% cheaper.

## Round 1: five questions, fixed-prefix caching

Each row is a completed run with the same five questions and 500-token answer cap. The model generated its own answers in each mode, so later histories and output lengths varied. “Ordinary” is calculated as input minus reads minus writes.

| Mode | Calls | Input | Cached reads | Cache writes | Ordinary input | Output | Calculated cost | Against no-cache full |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Full history, no cache | 5 | 9,326 | 0 | 0 | 9,326 | 1,106 | $0.001485600 | baseline |
| Full history, fixed-prefix cache | 5 | 9,596 | 4,452 | 1,113 | 4,031 | 987 | $0.001080245 | **27.3% less** |
| Compacted history, no cache | 6 | 11,140 | 0 | 0 | 11,140 | 1,296 | $0.001762000 | **18.6% more** |
| Compacted history, fixed-prefix cache | 6 | 11,110 | 4,452 | 2,359 | 4,299 | 1,141 | $0.001339795 | **9.8% less** |

**What happened:** the cache was placed after about 1,113 stable policy/instruction tokens. Later calls reused only that part. The conversation history was serialized into one changing user message, so the previous conversation was not reused as a growing cached prefix. Compaction required a sixth model call to create a checkpoint. In five turns, that extra call cost more than the subsequent shorter prompts saved. The cached/compacted mode also wrote a second prefix for the checkpoint call because its reasoning/output format changed.

These four successful runs cost **$0.005667640** together. Two earlier failed checkpoint attempts are counted in the all-attempt ledger below.

## Round 2: ten questions, append-only history

Here the earlier user, assistant, and tool messages stayed as separate, unchanged messages. A later request appended new messages. The same scripted prior history was used to measure cache mechanics, so the model's generated wording did not change the next prompt. A and B have a shared 500-token cap; C and D have a shared 1,000-token cap because the 500-token C/D attempts contained incomplete responses.

Unlike Round 1, D asked for a short conclusion alongside the normal answer and reused it after the completed tool step. It did not pay for a separate checkpoint request.

| Mode | Cap | Input | Cached reads | Cache writes | Ordinary input | Output | Calculated cost | Valid comparison |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| A. Full history, no cache | 500 | 25,864 | 0 | 0 | 25,864 | 3,214 | $0.004193400 | A versus B |
| B. Full history, fixed-prefix cache | 500 | 25,864 | 10,017 | 1,113 | 14,734 | 3,094 | $0.003259695 | **22.3% less** than A |
| C. Full history, growing cache | 1,000 | 25,864 | 22,618 | 3,216 | 30 | 3,341 | $0.002301680 | C versus D |
| D. One completed tool exchange compacted; growing cache | 1,000 | 18,025 | 14,697 | 3,298 | 30 | 3,505 | $0.002314720 | **0.57% more** than C |

**Do not compare A/B whole-call totals directly with C/D whole-call totals:** their output caps differ. Their *input-side* costs are still informative because the fixed transcript made the input token counts repeatable across caps. A's input cost was **$0.0025864**; B's was **$0.001712695**; C's was **$0.00063118**. So growing caching reduced the measured input-side cost by **75.6% versus A**, while output cost remained.

The provider reported this sequence of cached reads for C's ten turns: **0, 2,066, 2,260, 2,346, 2,429, 2,513, 2,601, 2,683, 2,767, 2,953**. That is the direct evidence that the reusable prefix grew. A matching prefix and a usable cache entry are required; a breakpoint alone does not promise a hit.

### Why 30% fewer input tokens did not save money in C versus D

| Cost part | C: full history | D: compact tool exchange | D minus C |
| --- | ---: | ---: | ---: |
| Ordinary input | $0.000003000 | $0.000003000 | $0 |
| Cached reads | $0.000226180 | $0.000146970 | **−$0.000079210** |
| Cache writes | $0.000402000 | $0.000412250 | +$0.000010250 |
| Output | $0.001670500 | $0.001752500 | +$0.000082000 |
| **Total** | **$0.002301680** | **$0.002314720** | **+$0.000013040** |

Compaction removed mostly tokens that C would have read from cache for only **$0.01 per million**. D also wrote 82 more cache tokens and produced 164 more output tokens. Those measured differences outweighed the cheaper reads. We cannot assign every extra output token specifically to the conclusion: model outputs varied between runs.

The later **two-question live continuation** cost $0.0007035 with full context and $0.0004638 with compact context. In the compact run, the model first acknowledged that its conclusion lacked an exact boundary, then refetched the relevant passages and answered with the correct deadlines. Both answers preserved the policy qualifier. This supports feasibility of *refetching after compaction*, while the sample remains too small for a general cost or quality claim.

## All recorded paid attempts

The IDs below are unique eight-character prefixes of the full variant IDs. The full IDs and events remain in local PostgreSQL and the experiment UI. “Incomplete” counts provider responses stopped at the output cap even where the run's stored status says `COMPLETE`. Such rows are spending records, not valid answer-quality comparisons. Tokens and calculated costs come from saved provider usage. Each mode is described above; `Live full` and `Live compact` are the two-question continuations.

### Round 1: six attempts

| Run | Mode | Status | API responses | Input | Cached | Writes | Output | Usage-backed cost |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| `52d5f027` | Full, no cache | complete | 5 | 9,326 | 0 | 0 | 1,106 | $0.001485600 |
| `f6fe080b` | Full, fixed cache | complete | 5 | 9,596 | 4,452 | 1,113 | 987 | $0.001080245 |
| `2163aaf7` | Compact, no cache | invalid; 1 incomplete | 6 | 11,013 | 0 | 0 | 1,342 | $0.001772300 |
| `7a6f15e7` | Compact, no cache | stopped | 2 measured | 3,283 | 0 | 0 | 450 | $0.000553300* |
| `7fb973b3` | Compact, no cache | complete | 6 | 11,140 | 0 | 0 | 1,296 | $0.001762000 |
| `16ce22a4` | Compact, fixed cache | complete | 6 | 11,110 | 4,452 | 2,359 | 1,141 | $0.001339795 |

\* The stopped `7a6f15e7` attempt has an error event with **no provider usage** for its attempted checkpoint. Its run ledger reserved another **$0.000341500**, making that run's conservative ledger amount **$0.000894800**. The reserved amount is an estimate, not a measured token charge. Thus Round 1 has **$0.007993240 backed by saved usage** and **$0.008334740 including that reservation**. The older `RESULTS.md` used the latter figure.

### Round 2: sixteen attempts

| Run | Mode | Cap | Status | API responses | Input | Cached | Writes | Output | Usage-backed cost |
| --- | --- | ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| `e91ed4e8` | A | 250 | stopped after input-format error | 1 | 2,068 | 0 | 0 | 218 | $0.000315800 |
| `1a04bf58` | A | 250 | 8 incomplete | 10 | 25,864 | 0 | 0 | 2,247 | $0.003709900 |
| `e8e560f9` | B | 250 | 7 incomplete | 10 | 25,864 | 10,017 | 1,113 | 2,254 | $0.002839695 |
| `bc30fa90` | C | 250 | 7 incomplete | 10 | 25,864 | 22,618 | 3,216 | 2,233 | $0.001747680 |
| `0ff2d275` | D | 250 | 6 incomplete | 10 | 18,025 | 14,697 | 3,298 | 2,390 | $0.001757220 |
| `56a906bf` | A | 500 | complete | 10 | 25,864 | 0 | 0 | 3,214 | $0.004193400 |
| `1a469ec1` | B | 500 | complete | 10 | 25,864 | 10,017 | 1,113 | 3,094 | $0.003259695 |
| `c4213387` | C | 500 | 1 incomplete | 10 | 25,864 | 22,618 | 3,216 | 3,048 | $0.002155180 |
| `53d7db90` | D | 500 | 3 incomplete | 10 | 18,025 | 14,697 | 3,298 | 3,505 | $0.002314720 |
| `8a80aba2` | Live full | 500 | failed | 4 | 6,330 | 0 | 0 | 226 | $0.000746000 |
| `65e6469f` | Live full | 500 | complete | 3 | 4,710 | 0 | 0 | 465 | $0.000703500 |
| `41bf8d74` | Live compact | 500 | stopped | 1 | 358 | 0 | 0 | 241 | $0.000156300 |
| `d428de59` | Live compact | 500 | stopped | 2 | 985 | 0 | 0 | 297 | $0.000247000 |
| `2acf25fa` | Live compact | 500 | complete | 3 | 1,863 | 0 | 0 | 555 | $0.000463800 |
| `48cacc87` | C | 1,000 | complete | 10 | 25,864 | 22,618 | 3,216 | 3,341 | $0.002301680 |
| `1c7312d7` | D | 1,000 | complete | 10 | 18,025 | 14,697 | 3,298 | 3,505 | $0.002314720 |

Round 2 usage-backed spend totals **$0.029226290**. Across all **22 recorded attempts**, saved provider usage supports **$0.037219530** in calculated cost. Adding the one Round 1 reservation with missing usage gives a **conservative local ledger total of $0.037561030**, or about **3.76 cents**. Neither number is an invoice; an unrecorded provider result cannot be recovered from token counts here.

## What we can conclude now

1. **Stable prefixes are worth caching when reused.** Both complete fixed-prefix pairs were cheaper, even after the first write charge.
2. **Preserving messages lets cached context grow.** Our second request shape demonstrated that with provider-reported cached tokens, while the first request shape could only reuse the fixed beginning.
3. **A shorter context is not automatically a cheaper conversation.** On the short ten-turn case, compaction mostly displaced low-cost cache reads and had slightly higher output/write cost. On the tiny live continuation it was cheaper and retained key answer facts after a refetch. Both observations belong in the story.
4. **No credible 90% whole-agent savings claim follows from these runs.** The clean comparisons are one run per mode, on one synthetic policy case, with different output caps between the A/B and C/D pairs. Answer quality received only a small manual review.

## What a future experiment could reveal

Run a **longer single workflow**, such as 30–50 turns with several large tool results. After each tool task finishes, keep a short conclusion with evidence IDs; refetch the original result only for a question that needs an exact detail. Compare full growing-cache history with selective compaction under the **same output cap** and fixed input transcript. Count the conclusion's output tokens, cache writes, later reads, refetches, failed calls, and all answers. Repeat a small number of times because output length and cache placement can vary.

The question to answer is concrete: **after how many later turns does the smaller active context repay the conclusion and cache-reset cost, while the agent still answers correctly?** A human should check the exact citations and policy qualifiers. We can estimate that break-even point from the saved token ledger before buying more API calls, then run only the useful cases. A longer run might show a real compaction benefit; the present data does not tell us its size.

## Practical decision numbers from these runs

These are cost calculations for **Luna at the rates above**, not universal turn-count rules. A future call helps only if it finds and reuses the expected cached prefix. Output length and answer quality can move the whole-call result.

| Choice | Measured or calculated break-even | What we would do |
| --- | --- | --- |
| Cache a stable prefix | **One later reuse** pays for the first cache write at these rates. | Cache stable instructions and source text when the next request is likely to repeat them exactly. |
| Let an append-only conversation enter the cache | Each segment that is written and then read at least once can repay its write premium. C read 22,618 cached tokens after writing 3,216. | Keep earlier messages unchanged when we expect another turn. Put changing timestamps or revised material after the stable beginning. |
| Make a **separate** model call to summarize | The old successful no-cache checkpoint call cost **$0.000371**. At $0.10/M ordinary input, later prompts must omit **at least 3,710 ordinary input tokens** just to repay that call. The first three later answers omitted only 385 tokens. | Avoid a separate checkpoint for a short conversation unless it removes a much larger history or serves many later turns. |
| Compact one tool exchange while growing cache is active | D's shorter prompt saved **871 input tokens on each of the nine turns after the first**. Most were $0.01/M cached reads, worth about **$0.00000871 per later turn**. After ten turns, D still trailed C by **$0.00001304**. | Compact when a large tool result will otherwise remain in many future prompts, then measure the answer and refetch cost as well as token savings. |

Here is the exact fixed-prefix calculation for a **1,113-token** prefix. Writing it once instead of processing it normally costs an extra `1,113 × ($0.125 − $0.10) / 1,000,000 = $0.000027825`. Each successful later cache read saves `1,113 × ($0.10 − $0.01) / 1,000,000 = $0.000100170`. **One reuse clears the write premium** and saves a net **$0.000072345 on input**. Nine reuses save **$0.000873705 on input**, which is exactly the measured A-versus-B input-cost difference. A and B's whole-call difference was $0.000933705 because B also generated 120 fewer output tokens; that output difference should not be credited to caching.

For the C-versus-D tool exchange, the **$0.00001304 remaining gap** would be recovered by **two more turns** *if* each turn again avoided 871 cached input tokens, both variants generated the same number of output tokens, and no new cache miss or write changed the comparison: `ceil($0.00001304 / $0.00000871) = 2`. This is an **illustrative break-even projection**, not an observed result. The generated output varied enough in the measured ten turns to reverse the token-saving advantage. If those 871 tokens were *uncached* instead, omitting them would save **$0.00008710 per turn**, ten times as much; that is why we must check the cache state before deciding to compact.

**Decision rule for this prototype:** cache stable material that will be reused; preserve an append-only recent conversation; compact a completed tool result only when its expected future token savings exceed the conclusion's output cost, any lost cache reuse, and likely refetch cost. Keep its passage IDs so the agent can recover an exact detail. Make the final decision from **total cost and correct answers**, not from input-token reduction alone.
