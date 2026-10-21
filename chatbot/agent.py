from pathlib import Path

from chatbot.tracing import initialize_langfuse

initialize_langfuse()

from google.adk.agents import LlmAgent
from chatbot.codex_model import CodexCliModel
from rag.search import search_documents


_INSTRUCTIONS = (Path(__file__).parent / "trusted_instructions.md").read_text(
    encoding="utf-8"
)

root_agent = LlmAgent(
    name="phase_one_chatbot",
    model=CodexCliModel(model="codex-cli"),
    description="A minimal local ADK chatbot for Phase 1.",
    instruction=_INSTRUCTIONS,
    tools=[search_documents],
)
