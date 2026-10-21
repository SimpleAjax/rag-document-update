# Project constitution

This is a **local learning prototype**. The user builds and tests it in phases to understand RAG ingestion, retrieval, reranking, agent tool calls, prompt injection, and traces. It is not being prepared for publication or production deployment.

## How we work

1. **Build the requested experiment quickly.** Make the smallest complete change that lets the user try the behavior they asked for. Keep the existing phase boundaries clear.
2. **Use Luna for delegated implementation.** When a subagent is available for project implementation, use `gpt-6-luna` at medium reasoning. The primary agent coordinates and reports; it does not duplicate the subagent's implementation work.
3. **Run essential checks.** Check the changed code and one real local path when needed to prove the experiment works. State what was checked and what remains unverified. Stop after those checks pass.
4. **Hand the UI to the user.** The user will interact with the local page and request changes. Implement functional UI behavior, then provide the run command or URL. Do browser visual analysis, theme polish, and extra screenshots only when the user asks.
5. **Avoid extra process.** Do not add a final audit, production hardening, extended benchmark, or repeated review after the requested experiment works unless the user asks or a concrete failure requires it.
6. **Keep the handoff short.** Say what is ready, how to run it, and any material limitation. Do not keep working after the user says they are taking over.

## Local boundaries

- Preserve unrelated worktree changes. Keep `.env` values and other secrets out of output and tracked files.
- Use the project's isolated PostgreSQL database and loopback web ports described in the README.
- Keep Langfuse as the detailed trace. Treat the project pages as teaching views of real local runs.
- When the user changes these defaults for a task, follow that request.
