from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from google.adk.agents import LlmAgent
from google.genai import types

from chatbot.codex_model import CodexCliModel
from chatbot.event_context import current_recorder
from chatbot.lab_runtime import ChatLabRuntime


FAKE_CODEX = r'''
import json, sys
prompt = sys.stdin.read()
if "FAIL THE MODEL" in prompt:
    print("safe stub failure", file=sys.stderr)
    sys.exit(3)
if "Just say hello" in prompt:
    action = {"action":"message", "text":"Hello.", "tool_name":"", "arguments_json":""}
else:
    seen = prompt.count("[ADK tool result]")
    if seen < 2:
        action = {"action":"tool_call", "text":"", "tool_name":"search_documents", "arguments_json":json.dumps({"query":f"search {seen + 1}", "top_k":1})}
    else:
        action = {"action":"message", "text":"I saw two search results.", "tool_name":"", "arguments_json":""}
print(json.dumps({"type":"item.completed", "item":{"type":"agent_message", "text":json.dumps(action)}}))
print(json.dumps({"type":"turn.completed"}))
'''


class MemoryRecorder:
    records = []

    @classmethod
    def create(cls, agent_name, session_id):
        cls.records = []
        return cls()

    def __init__(self):
        self.run_id = "test-run"
        self.turn_index = 0
        self.records = MemoryRecorder.records

    def set_turn(self, value):
        self.turn_index = value

    def record(self, kind, **kwargs):
        item = {"kind": kind, **kwargs}
        self.records.append(item)
        return len(self.records)

    def finish(self, status):
        self.status = status


def search_documents(query: str, top_k: int = 5) -> dict:
    """Stub search that records the same correlation point as production search."""
    result = {"results": [{"passage_id": query, "text": f"Result for {query}"}]}
    recorder = current_recorder()
    if recorder:
        recorder.record("search", input={"query": query, "top_k": top_k},
                        output={"passage_ids": [query]}, detail={"tool_result": result})
    return result


class ChatLabRuntimeTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        root = Path(self.temp.name)
        self.script = root / "fake_codex.py"
        self.script.write_text(FAKE_CODEX, encoding="utf-8")
        self.agent = LlmAgent(
            name="phase_one_chatbot",
            model=CodexCliModel(
                model="fake-codex", codex_command=[sys.executable, str(self.script)],
                workspace_root=root,
            ),
            instruction="Use the local search tool and answer from its results.",
            tools=[search_documents],
        )
        self.runtime = ChatLabRuntime()
        with patch("chatbot.lab_runtime.ChatEventRecorder", MemoryRecorder), \
             patch.object(self.runtime, "_agent", return_value=self.agent):
            self.session = await self.runtime.create_session("phase_one_chatbot")

    async def test_two_searches_have_actual_prompts_and_ordered_adk_events(self):
        with patch("chatbot.lab_runtime.ChatEventRecorder", MemoryRecorder):
            result = await self.runtime.ask(self.session["session_id"], "Find a policy answer")
        self.assertEqual(result["answer"], "I saw two search results.")
        kinds = [row["kind"] for row in MemoryRecorder.records]
        self.assertEqual(kinds.count("tool_call"), 2)
        self.assertEqual(kinds.count("tool_result"), 2)
        self.assertEqual(kinds.count("search"), 2)
        prompts = [row["detail"]["prompt"] for row in MemoryRecorder.records if row["kind"] == "model_input"]
        self.assertEqual(len(prompts), 3)
        self.assertIn("Result for search 1", prompts[1])
        self.assertIn("Result for search 1", prompts[2])
        self.assertIn("Result for search 2", prompts[2])
        self.assertEqual([row["sequence"] for row in MemoryRecorder.records if "sequence" in row], [])
        first_search = kinds.index("search")
        first_result = kinds.index("tool_result")
        self.assertLess(first_search, first_result)

    async def test_no_tool_turn_records_model_action_and_final_answer(self):
        with patch("chatbot.lab_runtime.ChatEventRecorder", MemoryRecorder):
            result = await self.runtime.ask(self.session["session_id"], "Just say hello")
        self.assertEqual(result["answer"], "Hello.")
        kinds = [row["kind"] for row in MemoryRecorder.records]
        self.assertIn("model_input", kinds)
        self.assertIn("model_decision", kinds)
        self.assertIn("answer", kinds)
        self.assertNotIn("tool_call", kinds)

    async def test_model_failure_is_persisted_and_marks_run_failed(self):
        with patch("chatbot.lab_runtime.ChatEventRecorder", MemoryRecorder):
            with self.assertRaises(Exception):
                await self.runtime.ask(self.session["session_id"], "FAIL THE MODEL")
        kinds = [row["kind"] for row in MemoryRecorder.records]
        self.assertIn("error", kinds)
        self.assertEqual(self.runtime._sessions[self.session["session_id"]].recorder.status, "FAILED")


if __name__ == "__main__":
    unittest.main()
