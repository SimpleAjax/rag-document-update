"""Baseline ADK agent with no application policy instruction."""

from chatbot.tracing import initialize_langfuse

initialize_langfuse()

from google.adk.agents import LlmAgent

from chatbot.codex_model import CodexCliModel
from rag.search import search_documents


root_agent = LlmAgent(
    name="baseline_chatbot",
    model=CodexCliModel(model="codex-cli", prompt_mode="chat_only"),
    description="",
    instruction="",
    tools=[search_documents],
)
