---
name: cimulink-blog-writer
description: Plan, draft, or revise a Cimulink engineering blog article from this project's experiments, traces, design notes, or code. Use for blog outlines, article drafts, evidence-led technical stories, and article visual plans; not for implementation docs or README edits.
---

# Cimulink Blog Writer

Turn one observed engineering problem into one canonical Cimulink website article. Write for the named reader first: a business owner or team lead who needs to understand the consequence, and a learner who wants to reproduce the mechanism. Follow the local audience guidance in `../../../../cimulink-content-system/blog_writing_practice.md` when accessible.

## 1. Establish the evidence

Read the relevant project design, code, run records, and the user's rough notes. Separate **observed result**, **derived calculation**, **illustrative scenario**, and **open question**. Record the model/provider, run date, sample count, code version, pricing source, and quality check behind any quantitative claim. Verify time-sensitive provider facts in current primary documentation. A planned experiment is described in future tense; write “we tried” only after a run exists.

## 2. Build the story

Start inside a concrete moment where the reader sees a consequence: a support answer, failed step, slow case, or surprising bill. State the business stakes before naming an API or technique. Move through the reader's question, the experiment, what the system actually did, the result, the catch, and the decision it supports. Choose an architecture or deep-dive structure when the mechanics need more space; let the evidence determine section count and order.

Explain each technical term with the case already on the page. Use short direct sentences and one main idea per paragraph. A human analogy can introduce a concept, then show where the analogy stops. Keep code excerpts short, from real files, and linked to their source. The article should remain useful to an owner who skips the code.

## 3. Make visuals carry an argument

Choose one or two visual arguments before making diagrams. Show a cause, flow, comparison, or state change with actual names and representative data. Use Mermaid for a small static flow, Excalidraw when an editable editorial diagram adds value and its tooling is available, or interactive HTML when the reader needs to step through calls or switch measured runs. Use Cimulink's brand palette from the current design system. Give every visual a plain-language caption and a readable fallback. Never style illustrative numbers as measured results.

## 4. Edit for a human voice

Read the draft aloud. Replace generic openings, inflated stakes, repeated three-part lists, formulaic contrasts, and one-line closers that repeat the preceding paragraph. Keep the author's real uncertainty, judgment, and specific observations. Preserve every verified fact, number, citation, code block, and link while editing prose. Ask for a missing fact or qualify it rather than inventing a quote, incident, saving, or customer outcome.

## 5. Finish the evidence check

Check that the headline matches the measured result and its scope. Compare every chart number with the saved run and its cost formula. Show failures, caveats, and sample limits near the result. The final article links the experiment code and primary provider documentation. Produce an article draft for review; publication and distribution are separate user decisions.

## Sources behind this project adaptation

This skill adapts concepts, rather than copying the external skill texts:

- [tech-article](https://github.com/ohugonnot/claude-skills/blob/main/plugins/tech-article/skills/tech-article/SKILL.md): scene-led technical storytelling.
- [technical-blog-writing](https://mcpfield.com/en/skills/technical-blog-writing): technical article structures and reproducible examples.
- [excalidraw-diagram-skill](https://github.com/coleam00/excalidraw-diagram-skill/blob/main/SKILL.md): diagrams that show a relationship and use concrete evidence.
- [humanizer](https://github.com/blader/humanizer/blob/main/SKILL.md): edit prose patterns while preserving facts and voice.
