"""In-memory ADK conversation sessions with durable local public event replay."""

from __future__ import annotations

import asyncio
import time
from dataclasses import dataclass
from typing import Any
from uuid import UUID

from google.adk.runners import InMemoryRunner
from google.genai import types

from chatbot.event_context import reset_recorder, use_recorder
from chatbot.event_recorder import ChatEventRecorder, get_run, list_runs


@dataclass
class ActiveChat:
    agent_name: str
    runner: InMemoryRunner
    session_id: str
    user_id: str
    recorder: ChatEventRecorder
    turn_index: int = 0
    busy: bool = False


class ChatLabRuntime:
    """Process-local ADK sessions; PostgreSQL stores replay, not resumable state."""

    def __init__(self):
        self._sessions: dict[str, ActiveChat] = {}
        self._lock = asyncio.Lock()
        self._tasks: dict[str, asyncio.Task] = {}

    @staticmethod
    def _agent(agent_name: str):
        if agent_name == "phase_one_chatbot":
            from chatbot.agent import root_agent
            return root_agent
        if agent_name == "baseline_chatbot":
            from baseline_chatbot.agent import root_agent
            return root_agent
        raise ValueError("Choose a known local chat agent.")

    async def create_session(self, agent_name: str) -> dict:
        agent = self._agent(agent_name)
        runner = InMemoryRunner(agent=agent, app_name=agent_name)
        user_id = "local-chat-lab"
        session = await runner.session_service.create_session(
            app_name=agent_name, user_id=user_id
        )
        recorder = ChatEventRecorder.create(agent_name, session.id)
        self._sessions[session.id] = ActiveChat(
            agent_name=agent_name, runner=runner, session_id=session.id,
            user_id=user_id, recorder=recorder,
        )
        return {"session_id": session.id, "run_id": str(recorder.run_id), "agent_name": agent_name}

    async def _begin_turn(self, session_id: str, question: str) -> ActiveChat:
        if not question.strip() or len(question) > 1000:
            raise ValueError("Enter a question from 1 to 1000 characters.")
        async with self._lock:
            chat = self._sessions.get(session_id)
            if chat is None:
                raise LookupError("This live ADK session is no longer available. Start a new session; saved runs can still be replayed.")
            if chat.busy:
                raise RuntimeError("This chat is still answering the previous question.")
            chat.busy = True
            chat.turn_index += 1
            chat.recorder.set_turn(chat.turn_index)
            chat.recorder.record("user", input={"text": question})
            chat.recorder.finish("RUNNING")
            return chat

    async def _execute_turn(self, chat: ActiveChat, question: str) -> dict:
        session_id = chat.session_id
        token = use_recorder(chat.recorder)
        started = time.perf_counter()
        final_texts: list[str] = []
        pending_tool_started: float | None = None
        try:
            async for event in chat.runner.run_async(
                user_id=chat.user_id,
                session_id=chat.session_id,
                new_message=types.Content(role="user", parts=[types.Part(text=question)]),
            ):
                for part in (event.content.parts if event.content else []):
                    if part.function_call:
                        call = part.function_call
                        chat.recorder.record(
                            "tool_call",
                            input={"tool": call.name, "arguments": call.args or {}},
                            output={"status": "called"},
                        )
                        pending_tool_started = time.perf_counter()
                    if part.function_response:
                        response = part.function_response
                        chat.recorder.record(
                            "tool_result",
                            input={"tool": response.name},
                            output={"result": response.response or {}},
                            duration_ms=(time.perf_counter() - pending_tool_started) * 1000
                            if pending_tool_started is not None else None,
                        )
                        pending_tool_started = None
                    if part.text and event.is_final_response():
                        final_texts.append(part.text)
                        chat.recorder.record("answer", output={"text": part.text})
            chat.recorder.finish("COMPLETE")
            return {
                "session_id": session_id,
                "run_id": str(chat.recorder.run_id),
                "turn_index": chat.turn_index,
                "answer": "\n".join(final_texts),
            }
        except Exception as exc:
            chat.recorder.record(
                "error",
                input={"stage": "ADK run"},
                output={"message": str(exc)},
                duration_ms=(time.perf_counter() - started) * 1000,
            )
            chat.recorder.finish("FAILED")
            raise
        finally:
            chat.busy = False
            reset_recorder(token)

    async def ask(self, session_id: str, question: str) -> dict:
        chat = await self._begin_turn(session_id, question)
        return await self._execute_turn(chat, question)

    async def start_turn(self, session_id: str, question: str) -> dict:
        """Start an ADK turn and return immediately for event polling."""
        chat = await self._begin_turn(session_id, question)
        task = asyncio.create_task(self._execute_turn(chat, question))
        run_id = str(chat.recorder.run_id)
        self._tasks[run_id] = task
        task.add_done_callback(lambda completed: completed.exception() if not completed.cancelled() else None)
        return {
            "session_id": session_id,
            "run_id": run_id,
            "turn_index": chat.turn_index,
            "status": "RUNNING",
        }

    def replay(self, run_id: UUID) -> dict | None:
        return get_run(run_id)

    def runs(self) -> list[dict]:
        return list_runs()

    def session_available(self, session_id: str) -> bool:
        return session_id in self._sessions


runtime = ChatLabRuntime()
