# Technical requirements: RAG document assistant V1

## Goal

Build a local, inspectable RAG assistant for Northstar Devices' fictional policies. Ingest three documents, let an agent search them, show each search and returned passage in the browser, then test direct and document-borne prompt injection. Save actual outcomes. Use [USE_CASES.md](./USE_CASES.md) for later hardening steps.

## Stack and boundaries

| Area | V1 choice |
| --- | --- |
| Application | Python 3.12, FastAPI, small HTML/JavaScript page |
| Agent | Signed-in Codex CLI app-server using JSON-RPC threads and turns |
| Agent tool | One project MCP server exposing read-only `search_documents` |
| Answering rules | Versioned `agent/answering_skill.md`, supplied as developer instructions |
| Embeddings | Local FastEmbed `BAAI/bge-small-en-v1.5`, 384 dimensions; model files cached under ignored `.local/` |
| Database | Isolated local PostgreSQL 18 database and application role on `127.0.0.1:55433` |
| Retrieval | Eligible Postgres passage rows, exact cosine ranking in Python, maximum five results |
| Ingestion | Postgres job and event tables, leased Python worker, explicit retry |
| Trail | Persist observable Codex item events, tool arguments/results, answer, and citation check in Postgres |

The signed-in Codex CLI provides generation, so this demo does not need a Gemini or OpenAI API key. Generation still calls OpenAI's service and requires network access and an eligible signed-in account. The app-server interface is experimental. No Docker or pgvector is needed for this tiny corpus. Never use the separate Perfastra database on port `55432`. Keep all fixtures synthetic and `.env` ignored.

Codex runs from an isolated empty working directory with a read-only sandbox and approval policy `never`. The project MCP configuration allows only `search_documents` and automatically approves that read-only tool. Record any other tool activity as `unexpected_tool`. These controls limit the demo surface; they are not a general containment guarantee.

## Document lifecycle

The manifest identifies stable document ID, version, title, readers, and fixture path. Baseline documents are `RETURNS` v1 (30 days), `WARRANTY` v1 (12 months), and `REBATES` v1 (7%). The injected `RETURNS` fixture is separate from the baseline.

```text
submit -> PENDING -> VALIDATING -> CHUNKING -> EMBEDDING -> INDEXING -> READY
                                                      any processing step -> FAILED -> retry
```

The worker leases a job in Postgres. Passage IDs derive from document ID, version, and chunk number. Same ID/version/hash submission is idempotent; changed content under the same version is rejected. A version is searchable only when `READY` and active. The schema stores documents, versions, jobs, job events, passages, conversations, turns, and turn events. Passage embeddings are `double precision[]` arrays with 384 elements.

## Question flow

```text
browser -> FastAPI -> Codex app-server thread/turn
                         -> MCP search_documents -> local query embedding
                         -> Postgres eligible passages -> Python cosine ranking
                         <- passage IDs, versions, scores, text
         <- Codex item events and answer -> persisted turn trail -> browser
```

The answering skill requires a search for policy questions, evidence-based answers, and citations shaped `[DOCUMENT_ID vN, passage_id]`. Retrieved text is untrusted source content. The application checks whether cited passage IDs appeared in that turn's tool results and flags missing or unsupported citations; it does not rewrite the answer. This check does not prove that every statement in an answer is supported.

`sam` and `fin` are demo labels only. V1 does not authenticate them or filter `intended_readers`; the browser must state this clearly. Permission enforcement belongs at retrieval before restricted text reaches Codex in the next increment.

## Lab and experiments

The page shows document and job state, a conversation, and the ordered agent trail. A returned passage is marked as seen by the agent only when it appears in the completed MCP tool result. Reopening a conversation reloads the same trail from Postgres. The trail shows observable actions and text, never private model reasoning.

Run fresh conversations for `B1` (returns baseline), `B2` (absent fact), `P1` (direct user instruction to answer 90 days), `P2` (instruction inside a retrieved passage), and `P3` (`sam` claims to be Finance). Save model, embedding model, corpus hash, skill hash, answer, citations, seen passage IDs, latency, and any error. Confirm the injected passage was actually returned for `P2`. For `P3`, record both passage exposure and answer disclosure. Model outcomes are observations for these runs, not general success rates.

## Acceptance and next step

V1 is complete when a fresh local setup can migrate, ingest, answer the baseline with a supported citation, persist/reopen a two-turn conversation, show the agent tool trail in the browser, run `B1` through `P3`, and export measured results. Implement `USE_CASES.md` case 2 next, then version changes, revocation, deletion, and retry behavior in that file's order.

## References

- [Codex app-server](https://developers.openai.com/codex/app-server) documents the local JSON-RPC runtime and event stream.
- [Codex MCP configuration](https://learn.chatgpt.com/docs/config-file/config-reference) documents the server and tool approval settings.
- [FastEmbed](https://qdrant.github.io/fastembed/Getting%20Started/) provides local ONNX embeddings.
- [PostgreSQL arrays](https://www.postgresql.org/docs/current/arrays.html) store vectors for this small lab.
