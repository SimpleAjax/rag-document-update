const $ = (selector) => document.querySelector(selector);
const ui = {
  themeToggle: $(".theme-toggle"), notice: $("#notice"), agent: $("#agent-select"),
  newSession: $("#new-session"), sessionNote: $("#session-note"), runList: $("#run-list"),
  refreshRuns: $("#refresh-runs"), runTitle: $("#run-title"), runSubtitle: $("#run-subtitle"),
  runStatus: $("#run-status"), messageForm: $("#message-form"), question: $("#question"),
  chatStatus: $("#chat-status"), eventCount: $("#event-count"), eventLine: $("#event-line"),
  eventDetail: $("#event-detail"), traceLink: $("#trace-link"),
};

let sessionId = null;
let runId = null;
let runs = [];
let runData = null;
let selectedSequence = null;
let pollTimer = null;
let pollBusy = false;

function node(tag, className, text) {
  const item = document.createElement(tag);
  if (className) item.className = className;
  if (text !== undefined && text !== null) item.textContent = String(text);
  return item;
}

function setNotice(text, error = false) {
  ui.notice.hidden = !text;
  ui.notice.className = error ? "notice error" : "notice";
  ui.notice.textContent = text || "";
}

async function requestJSON(url, options = {}) {
  const response = await fetch(url, { headers: { "Content-Type": "application/json" }, ...options });
  let body = {};
  try { body = await response.json(); } catch {}
  if (!response.ok) throw new Error(body.detail || `Request failed (${response.status}).`);
  return body;
}

function syncTheme() {
  const dark = document.documentElement.dataset.theme === "dark";
  ui.themeToggle.setAttribute("aria-pressed", String(dark));
  ui.themeToggle.setAttribute("aria-label", dark ? "Switch to light mode" : "Switch to dark mode");
  ui.themeToggle.title = dark ? "Light mode" : "Dark mode";
  ui.themeToggle.textContent = dark ? "☼" : "◐";
}

function toggleTheme() {
  const theme = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  document.documentElement.dataset.theme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", theme === "dark" ? "#11161A" : "#F9F9F8");
  try { localStorage.setItem("cimulink-theme", theme); } catch {}
  syncTheme();
}

function formatTime(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(date);
}

function formatDuration(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "";
  return value < 1000 ? `${Math.round(value)} ms` : `${(value / 1000).toFixed(2)} s`;
}

function pretty(value) {
  return typeof value === "string" ? value : JSON.stringify(value ?? {}, null, 2);
}

function eventSummary(event) {
  const input = event.input || {};
  const output = event.output || {};
  if (event.kind === "user") return input.text || "Question received";
  if (event.kind === "model_input") return `Codex received ${output.characters ?? "—"} prompt characters`;
  if (event.kind === "model_decision") return output.action === "tool_call" ? `Requested ${output.tool}` : output.text || "Returned a message";
  if (event.kind === "tool_call") return `${input.tool || "Tool"} · ${input.arguments?.query || "arguments recorded"}`;
  if (event.kind === "search") return `${output.result_count ?? 0} selected from ${event.detail?.cosine_candidates?.length ?? 0} cosine candidates`;
  if (event.kind === "tool_result") return `Result from ${input.tool || "tool"}`;
  if (event.kind === "answer") return output.text || "Final answer";
  if (event.kind === "error") return output.message || "The run stopped with an error";
  return event.kind;
}

function renderEvents() {
  const events = runData?.events || [];
  ui.eventLine.replaceChildren();
  ui.eventCount.textContent = `${events.length} recorded step${events.length === 1 ? "" : "s"}`;
  if (!events.length) {
    ui.eventLine.append(node("p", "quiet-copy", runData?.run?.status === "RUNNING" ? "Waiting for the first model event…" : "This run has no recorded events."));
    renderDetail(null);
    return;
  }
  for (const event of events) {
    const button = node("button", "event-point");
    button.type = "button";
    button.classList.toggle("selected", event.sequence === selectedSequence);
    button.classList.toggle("latest", event.sequence === events.at(-1).sequence);
    button.setAttribute("aria-pressed", String(event.sequence === selectedSequence));
    const seq = node("span", "event-sequence", String(event.sequence).padStart(2, "0"));
    const copy = node("span", "event-copy");
    const title = node("span", "event-title", event.kind.replaceAll("_", " "));
    const summary = node("span", "event-summary", eventSummary(event));
    copy.append(title, summary);
    const meta = node("span", "event-meta", [formatDuration(event.duration_ms), formatTime(event.occurred_at)].filter(Boolean).join(" · "));
    button.append(seq, copy, meta);
    button.addEventListener("click", () => { selectedSequence = event.sequence; renderEvents(); });
    ui.eventLine.append(button);
  }
  const chosen = events.find((event) => event.sequence === selectedSequence) || events.at(-1);
  selectedSequence = chosen.sequence;
  renderDetail(chosen);
}

function ioPane(label, text) {
  const pane = node("div", "io-pane");
  pane.append(node("h4", "", label), node("p", "", text || "—"));
  return pane;
}

function renderSearchInset(event, host) {
  const detail = event.detail || {};
  const reranked = detail.reranked_candidates || [];
  const selectedIds = new Set((detail.tool_result?.results || []).map((item) => item.passage_id));
  const inset = node("section", "search-inset");
  inset.append(node("h4", "", "Search ranking · all candidates"));
  const table = node("table", "rank-table");
  const head = document.createElement("thead");
  const header = document.createElement("tr");
  ["Passage", "Cosine", "Rerank", "Movement", "Agent"].forEach((text) => header.append(node("th", "", text)));
  head.append(header);
  const body = document.createElement("tbody");
  for (const candidate of reranked) {
    const row = document.createElement("tr");
    row.append(node("td", "", candidate.passage_id));
    row.append(node("td", "", `${candidate.cosine_score} · #${candidate.cosine_rank}`));
    row.append(node("td", "", `${candidate.rerank_score} · #${candidate.rerank_rank}`));
    row.append(node("td", "", `${candidate.cosine_rank} → ${candidate.rerank_rank}`));
    row.append(node("td", "", selectedIds.has(candidate.passage_id) ? "Returned" : "Not returned"));
    body.append(row);
  }
  table.append(head, body);
  inset.append(table);
  const versions = (detail.active_versions || []).map((item) => `${item.document_id} v${item.version}`).join(" · ") || "No active versions";
  inset.append(node("p", "quiet-copy", `Active versions searched: ${versions}. A rerank score orders candidates; it is not a probability.`));
  const returned = node("div", "returned-passages");
  for (const passage of detail.tool_result?.results || []) {
    const item = node("article", "returned-passage");
    item.append(node("strong", "", `${passage.document_id} v${passage.version} · ${passage.passage_id}`));
    item.append(node("p", "", passage.text));
    returned.append(item);
  }
  inset.append(returned);
  host.append(inset);
}

function renderDetail(event) {
  ui.eventDetail.replaceChildren();
  if (!event) {
    const empty = node("div", "empty-detail");
    empty.append(node("span", "section-kicker", "INPUT → OUTPUT"), node("h3", "", "Select a recorded step"), node("p", "", "Choose an event on the line to inspect its input and output."));
    ui.eventDetail.append(empty);
    return;
  }
  const heading = node("div", "detail-top");
  const title = node("div");
  title.append(node("span", "section-kicker", `STEP ${String(event.sequence).padStart(2, "0")} · ${event.kind.replaceAll("_", " ").toUpperCase()}`));
  title.append(node("h3", "", eventSummary(event).slice(0, 150)));
  title.append(node("p", "", `Turn ${event.turn_index} · ${formatTime(event.occurred_at)}${event.duration_ms == null ? "" : ` · ${formatDuration(event.duration_ms)}`}`));
  heading.append(title);
  ui.eventDetail.append(heading);

  const input = event.input || {};
  const output = event.output || {};
  let inputText = "—";
  let outputText = "—";
  if (event.kind === "user") { inputText = input.text || ""; outputText = "ADK turn started"; }
  else if (event.kind === "model_input") { inputText = `Conversation messages: ${output.message_count ?? "—"}; available tools: ${(output.available_tools || []).join(", ") || "none"}`; outputText = `Actual constructed prompt · ${output.characters ?? "—"} characters · ${output.tool_result_count ?? 0} prior tool results`; }
  else if (event.kind === "model_decision") { inputText = output.action === "tool_call" ? `Available tools: ${(input.available_tools || []).join(", ")}` : "Actual prompt shown in the preceding model input event."; outputText = output.action === "tool_call" ? `${output.tool}(${JSON.stringify(output.arguments || {})})` : output.text || "Message returned"; }
  else if (event.kind === "tool_call") { inputText = `${input.tool || "Tool"}(${JSON.stringify(input.arguments || {})})`; outputText = "The ADK requested this function."; }
  else if (event.kind === "search") { inputText = `${input.query || ""} · top_k ${input.top_k ?? "—"}`; outputText = `${output.result_count ?? 0} passages returned · ${output.tool_result_characters ?? "—"} tool JSON characters`; }
  else if (event.kind === "tool_result") { inputText = input.tool || "Tool result"; outputText = pretty(output.result || output); }
  else if (event.kind === "answer") { inputText = "Evidence and conversation available to the agent."; outputText = output.text || ""; }
  else if (event.kind === "error") { inputText = input.stage || "Last completed step"; outputText = output.message || "The run stopped with an error."; }

  ui.eventDetail.append(node("div", "io-labels", ""));
  const labels = ui.eventDetail.lastChild;
  labels.append(node("span", "", "INPUT"), node("span", "", "→"), node("span", "", "OUTPUT"));
  const grid = node("div", "io-grid");
  grid.append(ioPane("Input", inputText), node("span", "io-arrow", "→"), ioPane("Output", outputText));
  ui.eventDetail.append(grid);

  if (event.kind === "model_input") {
    const counts = node("div", "context-strip");
    counts.append(node("span", "", `${output.characters ?? "—"} characters`));
    counts.append(node("span", "", `${output.message_count ?? "—"} messages`));
    counts.append(node("span", "", `${output.tool_result_count ?? 0} tool results in prompt`));
    counts.append(node("span", "", `${output.tool_call_count ?? 0} prior tool calls`));
    ui.eventDetail.append(counts);
    const inspect = node("details", "inspect");
    inspect.append(node("summary", "", "Show the exact constructed prompt"));
    inspect.append(node("pre", "", event.detail?.prompt || "Prompt was unavailable."));
    ui.eventDetail.append(inspect);
  }
  if (event.kind === "model_decision" || event.kind === "tool_call" || event.kind === "tool_result") {
    const inspect = node("details", "inspect");
    inspect.append(node("summary", "", "Inspect exact structured input and output"));
    inspect.append(node("pre", "", pretty({ input: event.input, output: event.output })));
    ui.eventDetail.append(inspect);
  }
  if (event.kind === "search") renderSearchInset(event, ui.eventDetail);
  const traceId = event.detail?.trace_id;
  const traceUrl = event.detail?.trace_url;
  if (traceId && traceUrl) {
    ui.traceLink.hidden = false;
    ui.traceLink.replaceChildren();
    const link = node("a", "", `Open detailed Langfuse trace ${traceId}`);
    link.href = traceUrl;
    link.target = "_blank";
    link.rel = "noreferrer";
    ui.traceLink.append(link);
  } else {
    ui.traceLink.hidden = true;
  }
}

function renderRunList() {
  ui.runList.replaceChildren();
  if (!runs.length) { ui.runList.append(node("p", "quiet-copy", "No saved chat runs yet.")); return; }
  for (const run of runs) {
    const button = node("button", "run-item");
    button.type = "button";
    button.classList.toggle("selected", run.run_id === runId);
    button.append(node("strong", "", `${run.agent_name === "baseline_chatbot" ? "Baseline assistant" : "Policy assistant"} · ${run.status}`));
    button.append(node("span", "", `${formatTime(run.updated_at)} · ${run.run_id.slice(0, 8)}`));
    button.addEventListener("click", () => selectRun(run.run_id));
    ui.runList.append(button);
  }
}

async function refreshRuns() {
  try {
    const body = await requestJSON("/api/runs");
    runs = body.runs || [];
    renderRunList();
  } catch (error) { setNotice(error.message, true); }
}

function updateRunHeader() {
  const run = runData?.run;
  ui.runTitle.textContent = run ? `${run.agent_name === "baseline_chatbot" ? "Baseline assistant" : "Policy assistant"} · ${run.run_id.slice(0, 8)}` : "Start a new session";
  ui.runSubtitle.textContent = run ? `Saved local run · session ${run.session_id}` : "Each event is saved as the run happens.";
  ui.runStatus.textContent = run?.status || "READY";
  ui.runStatus.classList.toggle("running", run?.status === "RUNNING");
}

async function loadRun(id) {
  const body = await requestJSON(`/api/runs/${id}`);
  runId = id;
  runData = body;
  if (!selectedSequence || !body.events.some((event) => event.sequence === selectedSequence)) {
    selectedSequence = body.events.at(-1)?.sequence ?? null;
  }
  updateRunHeader();
  renderEvents();
  renderRunList();
  return body;
}

async function selectRun(id) {
  stopPolling();
  try {
    const body = await loadRun(id);
    sessionId = sessionId === body.run.session_id ? sessionId : null;
    ui.chatStatus.textContent = sessionId ? "This run belongs to the current live session." : "Replay view. Start a new session to continue chatting.";
    ui.question.disabled = !sessionId;
    ui.messageForm.querySelector("button[type=submit]").disabled = !sessionId;
    if (body.run.status === "RUNNING") beginPolling();
  } catch (error) { setNotice(error.message, true); }
}

function stopPolling() { if (pollTimer) clearTimeout(pollTimer); pollTimer = null; }
function beginPolling() {
  stopPolling();
  const poll = async () => {
    if (!runId || pollBusy) return;
    pollBusy = true;
    try {
      const body = await loadRun(runId);
      await refreshRuns();
      if (body.run.status === "RUNNING") pollTimer = setTimeout(poll, 350);
      else {
        ui.chatStatus.textContent = body.run.status === "FAILED" ? "The run stopped. Review the recorded error step." : "Run complete. Select any event to replay its input and output.";
        setMessageEnabled(Boolean(sessionId));
      }
    } catch (error) {
      ui.chatStatus.textContent = error.message;
    } finally { pollBusy = false; }
  };
  poll();
}

function setMessageEnabled(enabled) {
  ui.question.disabled = !enabled;
  ui.messageForm.querySelector("button[type=submit]").disabled = !enabled;
}

async function createSession() {
  stopPolling();
  ui.newSession.disabled = true;
  try {
    const created = await requestJSON("/api/sessions", {
      method: "POST", body: JSON.stringify({ agent_name: ui.agent.value }),
    });
    sessionId = created.session_id;
    runId = created.run_id;
    try { sessionStorage.setItem("chat-lab-session", sessionId); } catch {}
    ui.sessionNote.textContent = `Live ${created.agent_name} session. Event history saves to the local project database.`;
    setMessageEnabled(true);
    ui.chatStatus.textContent = "Session ready. Enter a question.";
    await refreshRuns();
    await loadRun(runId);
    ui.question.focus();
  } catch (error) { setNotice(error.message, true); }
  finally { ui.newSession.disabled = false; }
}

async function sendQuestion(event) {
  event.preventDefault();
  const question = ui.question.value.trim();
  if (!sessionId) { ui.chatStatus.textContent = "Start a session before sending a question."; return; }
  if (!question) { ui.chatStatus.textContent = "Enter a question first."; ui.question.focus(); return; }
  setMessageEnabled(false);
  ui.chatStatus.textContent = "The agent is working. New events appear here as they are recorded.";
  try {
    const started = await requestJSON(`/api/sessions/${encodeURIComponent(sessionId)}/messages`, {
      method: "POST", body: JSON.stringify({ question }),
    });
    runId = started.run_id;
    selectedSequence = null;
    ui.question.value = "";
    await loadRun(runId);
    beginPolling();
  } catch (error) {
    ui.chatStatus.textContent = error.message;
    setMessageEnabled(true);
  }
}

async function restoreLiveSession() {
  try { sessionId = sessionStorage.getItem("chat-lab-session"); } catch { sessionId = null; }
  if (!sessionId) return;
  try {
    const state = await requestJSON(`/api/sessions/${encodeURIComponent(sessionId)}`);
    if (!state.available) {
      sessionId = null;
      try { sessionStorage.removeItem("chat-lab-session"); } catch {}
      ui.sessionNote.textContent = state.message;
      return;
    }
    ui.question.disabled = false;
    ui.messageForm.querySelector("button[type=submit]").disabled = false;
    ui.sessionNote.textContent = "Restored the current process-local live session.";
  } catch { sessionId = null; }
}

ui.themeToggle.addEventListener("click", toggleTheme);
ui.newSession.addEventListener("click", createSession);
ui.refreshRuns.addEventListener("click", refreshRuns);
ui.messageForm.addEventListener("submit", sendQuestion);

async function boot() {
  syncTheme();
  await refreshRuns();
  await restoreLiveSession();
  if (sessionId) {
    try {
      const response = await requestJSON(`/api/sessions/${encodeURIComponent(sessionId)}`);
      if (response.available) {
        const existing = runs.find((run) => run.session_id === sessionId);
        if (existing) {
          await loadRun(existing.run_id);
          if (existing.status === "RUNNING") beginPolling();
        }
      }
    } catch {}
  }
  renderRunList();
}

boot();
