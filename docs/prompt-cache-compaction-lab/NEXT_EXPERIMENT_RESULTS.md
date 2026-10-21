# Growing cache and selective compaction results

**Run date:** 2026-10-19  
**Model:** `gpt-6-luna` via the Responses API  
**Scenario:** 10 fixed Northstar Devices returns and shipping turns; reasoning low  
**Spend accounting:** provider-reported input, cached input, cache-write, and output usage at the verified rates. Cache-read and cache-write tokens are subsets of input tokens.

## Findings

### Growing cache

Run C at a 1,000-token output cap completed 10/10 responses: `48cacc87-b44d-460f-bb7b-443b3f85d77d`. Provider-reported cached tokens by turn were `0, 2066, 2260, 2346, 2429, 2513, 2601, 2683, 2767, 2953`. This confirms growth of the reusable prefix for this fixed append-only transcript. Total usage was 25,864 input tokens, 22,618 cached tokens, 3,216 cache-write tokens, and 3,341 output tokens; derived cost was **$0.002301680**.

### Selective compaction and total cost

Run D at the same 1,000-token output cap completed 10/10 responses: `1c7312d7-97c3-458f-ace7-18a8b2f2ba9c`. Total usage was 18,025 input tokens, 14,697 cached tokens, 3,298 cache-write tokens, and 3,505 output tokens; derived cost was **$0.002314720**.

Compaction removed 7,839 input tokens (30.3%) across the run, but **did not reduce total cost**. D cost **$0.000013040 more** than C. D wrote 82 more cache tokens and generated 164 more output tokens; these charges outweighed the ordinary input savings for this short transcript. The measured result does not establish a long-run break-even point.

### Fixed-prefix comparison

The clean A/B pair at output cap 500 completed all ten API responses: A `56a906bf-7e80-43fe-928a-8024fbc06636` (no cache, **$0.004193400**) and B `1a469ec1-1c77-465d-b289-b45696d5f22c` (fixed-prefix cache, **$0.003259695**). B was **$0.000933705 cheaper** for this pair. It recorded 10,017 cached tokens and 1,113 cache-write tokens. This pair is comparable at its shared cap. Its totals should not be compared directly with the C/D 1,000-cap pair.

## Answer-quality review

Manual review of the successful C/D 1,000-cap scripted answers found the key deadlines and qualifications preserved. Both variants distinguished the three-calendar-day SHIPPING visible-damage rule from the seven-calendar-day RETURNS damaged-or-incorrect-delivery rule, and both retained the 21-day return-period qualifier. C acknowledged that it could not verify the tracking passage ID at turn 5. D cited `SHIPPING-v2-P2` correctly. D also separated the policy's lack of a promised replacement or refund from support's next review step.

The separate two-question live continuation completed in both modes. Full-context run `65e6469f-b19f-46bc-a2e9-6973c6016393` cost **$0.000703500**. Compact-context run `2acf25fa-b67b-4e5f-9f20-461d5ee35de8` cost **$0.000463800**. The compact continuation first stated it could not verify the exact day-count boundary from the conclusion alone, then used a local refetch and answered the later question with the correct `SHIPPING-v2-P5` and `RETURNS-v3-P4` evidence. Both final answers preserved the distinct three-day and seven-day deadlines and said the latter does not shorten the 21-day return period. This is a small two-question manual sample, not a general answer-quality evaluation.

## Preserved incomplete and failed runs

The 500-cap C run `c4213387-8c18-4aaf-bd32-ac3018cab78b` had one incomplete response at turn 7 (500 output tokens). The 500-cap D run `53d7db90-bc0c-4b7d-a0f9-4d4da750829e` had three incomplete responses at turns 6–8 (500 output tokens). They are preserved and not used for the C/D conclusion. The targeted 1,000-cap C/D runs completed without an incomplete response.

The initial 250-cap A attempt `e91ed4e8-8789-46e5-8c8e-2f2ba02c1512` stopped after one provider call when the API rejected the subsequent request. Inspection found the request history encoded assistant content as `input_text`; Responses API assistant history requires `output_text`. The request assembly was corrected, and the failed run remains preserved. The completed 250-cap A/B/C/D runs are retained as earlier measurements, not used for the paired conclusion because their cap was too low for useful outputs.

Live-continuation attempts retained in the ledger: full-context failure `8a80aba2-9b00-4738-8ad7-e929eecf0cd4`; compact stop after reasoning-item handling `41bf8d74-59f1-43d2-a3c9-c210dd1c9913`; and compact stop after strict document-ID validation `d428de59-6dae-497d-98d8-12912ca114e7`. These were not retried automatically. The later successful full and compact runs above are the only live-continuation results used in the review.

Across these **16 recorded paid attempts** (250-, 500-, and 1,000-cap fixed runs; live attempts and their preserved failures), derived spend totals **$0.029226290**. Each fixed variant's preflight maximum was below the $0.25 cap; no fixed variant exceeded its cap. No automatic retry was made.

## Provider contract and limits

The provider returned valid Responses API output only after the assistant-history content type was corrected to `output_text`; user and developer content remain `input_text`. The active cache rule follows the verified 1,024-visible-token minimum and cache usage fields are recorded per response. The rate snapshot was checked on 2026-10-19 against the [GPT-6 Luna model page](https://developers.openai.com/api/docs/models/gpt-6-luna), [prompt caching guide](https://developers.openai.com/api/docs/guides/prompt-caching), and [pricing page](https://developers.openai.com/api/docs/pricing): input $0.10/M tokens, cached input $0.01/M, cache writes $0.125/M, output $0.50/M.

The fixed transcript holds later scripted wording constant, so its quality result is limited to reviewed outputs and cache/cost mechanics. The live continuation exercises a small amount of real lookup behavior. Results are specific to this model, fixture, rate snapshot, and short transcript; verify current rates and API rules before another paid run.
