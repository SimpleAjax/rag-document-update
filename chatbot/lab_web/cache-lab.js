const $ = (selector) => document.querySelector(selector);
const ui = {
  notice: $("#notice"), mode: $("#mode-select"), modeExplainer: $("#mode-explainer"), cap: $("#output-cap"),
  preflightButton: $("#preflight-button"), preflightResult: $("#preflight-result"), ack: $("#paid-ack"), start: $("#start-button"),
  budgetCap: $("#budget-cap"), remaining: $("#budget-remaining"), rateVerified: $("#rate-verified"), rateNote: $("#rate-note"),
  runList: $("#run-list"), refreshRuns: $("#refresh-runs"), runTitle: $("#run-title"), runSubtitle: $("#run-subtitle"),
  runStatus: $("#run-status"), metricCost: $("#metric-cost"), metricInput: $("#metric-input"), metricLatency: $("#metric-latency"),
  metricCheckpoint: $("#metric-checkpoint"), conversationLabel: $("#conversation-label"), conversation: $("#conversation"),
  replay: $("#replay-button"), export: $("#export-button"), retry: $("#retry-button"), context: $("#context-assembly"),
  history: $("#full-history"), checkpoint: $("#checkpoint-inspector .checkpoint-body"), ledger: $("#ledger-body"),
  comparison: $("#comparison-chart"), refetchPanel: $("#refetch-panel"), refetchButton: $("#refetch-button"),
};
const MODES = {
  no_cache_full: { label: "No cache · full history", cache: false, compact: false, explainer: "Explicit cache mode with no breakpoint. The provider should report zero cached and cache-write tokens; any nonzero value is shown as an anomaly." },
  cache_full: { label: "Cache · full history", cache: true, compact: false, explainer: "Explicit cache mode with a breakpoint on the stable developer prefix. A declared breakpoint does not guarantee a cache hit." },
  no_cache_compact: { label: "No cache · compacted history", cache: false, compact: true, explainer: "Explicit cache mode with no breakpoint. A checkpoint and recent turns replace older history in the active prompt; the original events remain saved." },
  cache_compact: { label: "Cache · compacted history", cache: true, compact: true, explainer: "Explicit cache mode with the same stable-prefix breakpoint. The checkpoint and changing context follow it; caching and input reduction are measured independently." },
};
let metadata = null;
let preflight = null;
let runs = [];
let runData = null;
let activeVariantId = null;
let activeRequestSequence = null;
let blindReview = false;

function node(tag, className = "", text = "") {
  const item = document.createElement(tag);
  if (className) item.className = className;
  if (text !== undefined && text !== null) item.textContent = String(text);
  return item;
}
function safe(value, fallback = "—") { return value === null || value === undefined || value === "" ? fallback : String(value); }
function json(value) { try { return JSON.stringify(value, null, 2); } catch { return String(value ?? ""); } }
function num(value, digits = 4) { return typeof value === "number" && Number.isFinite(value) ? value.toLocaleString(undefined, { maximumFractionDigits: digits }) : "unknown"; }
function usd(value) { return typeof value === "number" && Number.isFinite(value) ? `$${value.toFixed(6)}` : "unknown"; }
function setNotice(message, error = false) { ui.notice.hidden = !message; ui.notice.className = error ? "notice error" : "notice"; ui.notice.textContent = message || ""; }
async function requestJSON(url, options = {}) {
  const response = await fetch(url, { headers: { "Content-Type": "application/json" }, ...options });
  let body = {};
  try { body = await response.json(); } catch {}
  if (!response.ok) throw new Error(body.detail || `Request failed (${response.status}).`);
  return body;
}
function selectedMode() { return MODES[ui.mode.value] || MODES.no_cache_full; }
function capValue() { const value = Number(ui.cap.value); return Number.isInteger(value) ? value : 0; }
function clearPreflight() {
  preflight = null;
  ui.preflightResult.className = "preflight-result";
  ui.preflightResult.textContent = "Preflight is required before starting.";
  ui.start.disabled = true;
  ui.ack.checked = false;
  updateStartState();
}
function preflightAllowed(result) { return Boolean(result?.allowed ?? result?.ok ?? result?.can_start ?? result?.ready); }
function updateStartState() { ui.start.disabled = !(preflight && preflightAllowed(preflight) && ui.ack.checked); }
function updateModeText() { ui.modeExplainer.textContent = selectedMode().explainer; }
function duration(value) { return typeof value === "number" ? (value < 1000 ? `${Math.round(value)} ms` : `${(value / 1000).toFixed(2)} s`) : "unknown"; }

function applyMetadata(value) {
  metadata = value;
  const scenario = value.scenario || {};
  const budget = value.budget || {};
  const rate = value.rate_card || value.rates || {};
  if (Array.isArray(scenario.questions)) {
    const list = document.querySelector(".scenario-card ol");
    list.replaceChildren(...scenario.questions.map((question) => node("li", "", typeof question === "string" ? question : question.text)));
  }
  if (scenario.name || scenario.title) document.querySelector(".scenario-card h3").textContent = scenario.name || scenario.title;
  if (scenario.policy_version || scenario.policy_version_id || scenario.version || scenario.passage_ids || scenario.passages) {
    const passages = scenario.passage_ids || scenario.passages || ["RET-03", "RET-07"];
    const records = passages.map((item) => typeof item === "string" ? { passage_id: item } : item).filter((item) => item.passage_id || item.id);
    const groups = new Map();
    records.forEach((item) => { const key = `${item.document_id || "POLICY"} ${item.version ? `v${item.version}` : ""}`.trim(); groups.set(key, [...(groups.get(key) || []), item.passage_id || item.id]); });
    document.querySelector(".scenario-card p").textContent = [...groups.entries()].map(([key, ids]) => `${key} · ${ids.join(", ")}`).join("; ");
    $("#passage-ids").replaceChildren(...records.map((item) => { const option = document.createElement("option"); option.value = item.passage_id || item.id; return option; }));
  }
  ui.budgetCap.textContent = usd(budget.cap_usd ?? value.budget_cap_usd ?? 0.25);
  ui.remaining.textContent = usd(budget.remaining_usd ?? value.remaining_budget_usd ?? value.budget_cap_usd ?? 0.25);
  const verified = rate.verified_at || rate.verified_at_utc || rate.last_verified_at || value.rate_verified_at;
  ui.rateVerified.textContent = verified ? `Verified ${verified}` : "Needs verification";
  ui.rateNote.textContent = `${rate.note || "Rates require re-verification before a paid run."}${rate.url ? ` Source: ${rate.url}` : ""}`;
  const prices = rate.rates_per_million_usd || rate;
  if (typeof prices.input === "number") {
    ui.rateNote.textContent = `Planning rates per 1M: ordinary input $${prices.input}; cached $${prices.cached_input ?? "unknown"}; cache write $${prices.cache_write ?? "unknown"}; output $${prices.output ?? "unknown"}. Re-verify before a paid run.${rate.url ? ` Source: ${rate.url}` : ""}`;
  }
  if (value.key_available === false || value.api_key_available === false) {
    ui.rateNote.textContent += " OPENAI_API_KEY is unavailable. Preflight will fail closed. The key itself is never shown here.";
  }
  const prefixTokens = value.visible_prefix_token_estimate;
  const minimum = value.minimum_prefix_tokens ?? value.required_prefix_tokens ?? 1024;
  if (typeof prefixTokens === "number" && (value.cache_eligible === false || prefixTokens < minimum)) {
    ui.rateNote.textContent += ` Local tokenizer estimate: ${prefixTokens} visible tokens; explicit cache mode needs at least ${minimum}. Cache variants will stay blocked until the legitimate stable prefix meets the documented threshold.`;
  } else if (typeof prefixTokens === "number") {
    ui.rateNote.textContent += ` Local tokenizer estimate: ${prefixTokens} visible tokens. Provider token counts and cache matching remain authoritative.`;
  }
}

async function loadMetadata() {
  try { applyMetadata(await requestJSON("/api/cache-lab/metadata")); }
  catch (error) { setNotice(`Experiment metadata could not load: ${error.message}`, true); }
}
async function checkPreflight() {
  const cap = capValue();
  if (cap < 1 || cap > 500) { setNotice("Output cap must be between 1 and 500 tokens.", true); clearPreflight(); return; }
  ui.preflightButton.disabled = true;
  ui.preflightResult.className = "preflight-result";
  ui.preflightResult.textContent = "Checking key availability, verified rates, and the maximum planned spend…";
  try {
    preflight = await requestJSON("/api/cache-lab/preflight", {
      method: "POST", body: JSON.stringify({ mode: ui.mode.value, output_token_cap: cap }),
    });
    const estimate = preflight.estimated_max_cost_usd ?? preflight.estimated_maximum_usd ?? preflight.estimated_max_usd ?? preflight.maximum_estimate_usd;
    const remaining = preflight.remaining_budget_usd ?? preflight.available_budget_usd;
    const reasons = preflight.reasons || preflight.blockers || preflight.blocked_reasons || [];
    if (preflightAllowed(preflight)) {
      ui.preflightResult.className = "preflight-result ready";
      ui.preflightResult.textContent = `Ready for review. Estimated maximum ${usd(estimate)}${remaining == null ? "" : ` · budget remaining ${usd(remaining)}`}. ${preflight.estimate_assumptions || "Includes planned checkpoint/answer calls and one explicitly allowed retry reserve."}`;
    } else {
      ui.preflightResult.className = "preflight-result blocked";
      ui.preflightResult.textContent = `Blocked: ${reasons.map((item) => typeof item === "string" ? item : item.message).join("; ") || preflight.reason || "The paid-run safety checks did not pass."}`;
    }
    updateStartState();
  } catch (error) {
    preflight = { allowed: false, reason: error.message };
    ui.preflightResult.className = "preflight-result blocked";
    ui.preflightResult.textContent = `Preflight failed: ${error.message}`;
  } finally { ui.preflightButton.disabled = false; }
}

function eventText(event) {
  const input = event.input || {};
  const output = event.output || {};
  if (event.kind === "user" || event.kind === "question") return input.text || input.question || output.text || "Scripted question";
  if (event.kind === "answer" || event.kind === "response") return output.text || output.answer || output.output_text || "Response recorded";
  if (event.kind === "refetch" || event.kind === "tool" || event.kind === "tool_result") return output.summary || output.text || input.passage_id || "Evidence refetched";
  if (event.kind === "checkpoint") return output.decision || output.summary || "Checkpoint saved";
  if (event.kind === "error" || event.kind === "budget_stop") return output.message || output.reason || event.kind;
  return output.text || input.text || event.kind.replaceAll("_", " ");
}
function eventClass(event) {
  if (["user", "question"].includes(event.kind)) return "user";
  if (["answer", "response"].includes(event.kind)) return "assistant";
  return "system";
}
function eventCitations(event) {
  const output = event.output || {};
  const input = event.input || {};
  const citations = output.citations || output.sources || input.citations || [];
  if (!Array.isArray(citations)) return [];
  return citations.map((item) => typeof item === "string" ? item : [item.document_id, item.version ? `v${item.version}` : null, item.passage_id].filter(Boolean).join(" · ")).filter(Boolean);
}
function renderConversation() {
  const events = runData?.events || [];
  ui.conversation.replaceChildren();
  const anomalies = events.filter((event) => event.output?.cache_anomaly || event.detail?.cache_anomaly);
  if (anomalies.length) ui.conversation.append(node("div", "anomaly", `No-cache usage anomaly: the provider reported cached or cache-write tokens in ${anomalies.length} call${anomalies.length === 1 ? "" : "s"}. Review the measured usage in the ledger.`));
  if (!events.length) { ui.conversation.className = "conversation empty-state"; ui.conversation.append(node("p", "", "This run has no events yet. A checkpoint does not delete the saved conversation history.")); return; }
  ui.conversation.className = "conversation";
  for (const event of events) {
    if (["request", "response", "model_request"].includes(event.kind)) continue;
    const card = node("article", `turn-card ${eventClass(event)}`);
    const label = event.kind.replaceAll("_", " ");
    card.append(node("h4", "", `${label} · sequence ${event.sequence}`));
    card.append(node("p", "", eventText(event)));
    for (const citation of eventCitations(event)) card.append(node("span", "citation", citation));
    const usage = event.output?.usage;
    if (usage) card.append(node("div", "event-meta-line", `input ${num(usage.input_tokens)} · output ${num(usage.output_tokens)} · cached ${num(usage.cached_tokens)} · cache write ${num(usage.cache_write_tokens)}`));
    if (event.output?.cache_anomaly || event.detail?.cache_anomaly) card.append(node("div", "anomaly", "No-cache anomaly: provider reported cached or cache-write tokens for a no-cache variant."));
    ui.conversation.append(card);
  }
}

function getUsage(event) { return event.output?.usage || event.detail?.usage || event.usage || {}; }
function getCost(event) { return event.output?.usage?.derived_cost_usd ?? event.output?.derived_cost_usd ?? event.output?.cost_usd ?? event.detail?.derived_cost_usd ?? event.derived_cost_usd; }
function renderLedger() {
  const events = runData?.events || [];
  const responses = events.filter((event) => event.kind === "response" || event.output?.usage);
  const calls = responses.map((event) => ({ event, request: events.filter((candidate) => candidate.kind === "request" && candidate.turn_index === event.turn_index && candidate.sequence < event.sequence).at(-1) }));
  for (const event of events.filter((item) => ["request", "error", "budget_stop"].includes(item.kind))) {
    if (!responses.some((response) => response.turn_index === event.turn_index && response.sequence > event.sequence)) calls.push({ event, request: null });
  }
  calls.sort((left, right) => (left.event.sequence || 0) - (right.event.sequence || 0));
  ui.ledger.replaceChildren();
  if (!calls.length) { const row = document.createElement("tr"); row.append(node("td", "quiet-copy", "No request events recorded yet.")); row.firstChild.colSpan = 10; ui.ledger.append(row); return; }
  for (const call of calls) {
    const event = call.event;
    const request = call.request;
    const usage = getUsage(event);
    const row = document.createElement("tr");
    [request?.detail?.type || event.detail?.type || event.kind, safe(request?.detail?.attempt ?? event.detail?.attempt ?? event.output?.attempt), duration(event.duration_ms), num(usage.input_tokens, 0), num(usage.output_tokens, 0), num(usage.cached_tokens, 0), num(usage.cache_write_tokens, 0), num(usage.ordinary_input_tokens, 0)].forEach((value) => row.append(node("td", "", value)));
    const costCell = node("td", "ledger-cost");
    costCell.append(node("strong", "", usd(getCost(event))));
    costCell.append(node("span", "metric-label derived", "Derived estimate"));
    const reserve = request?.detail?.estimated_max_cost_usd;
    if (typeof reserve === "number") costCell.append(node("small", "", `Pre-dispatch maximum ${usd(reserve)}`));
    row.append(costCell);
    row.append(node("td", "", safe(event.output?.finish_status || event.output?.status || event.detail?.status || (event.kind === "budget_stop" ? event.detail?.reason : "recorded"))));
    ui.ledger.append(row);
  }
}

function requestEvents(events) { return events.filter((event) => /request/i.test(event.kind) || event.input?.serialized_payload || event.detail?.serialized_payload); }
function firstValue(...items) { return items.find((value) => value !== undefined && value !== null && value !== ""); }
function renderContext() {
  const events = runData?.events || [];
  const reqs = requestEvents(events);
  ui.context.replaceChildren();
  if (!reqs.length) ui.context.append(node("p", "quiet-copy", "Select a saved request event after a run. Prompt sections and hashes are shown as sent locally."));
  else {
    const current = reqs.find((event) => event.sequence === activeRequestSequence) || reqs.at(-1);
    activeRequestSequence = current.sequence;
    const payload = current.input?.serialized_payload || current.input?.payload || current.detail?.serialized_payload || current.detail?.prompt_snapshot || {};
    const prompt = current.input?.prompt || current.detail?.prompt;
    const prefix = current.input?.prefix || current.detail?.prefix;
    const boundary = "--- CASE CONTEXT START ---";
    let sections = current.input?.sections || current.detail?.sections || payload.input || current.input?.active_context || payload;
    if (typeof prompt === "string" && typeof prefix === "string") {
      sections = [
        { title: "Stable developer instructions and tool schema", content: prefix.includes(boundary) ? prefix.slice(0, prefix.indexOf(boundary)).trim() : prefix },
        { title: "Visible case boundary", content: boundary },
        { title: "Active model context", content: current.input?.active_context || "No separate active-context object was recorded." },
        { title: "Changing prompt tail · first local divergence", content: prompt.startsWith(prefix) ? prompt.slice(prefix.length).trim() : prompt },
      ];
    }
    const list = Array.isArray(sections) ? sections : Object.entries(sections && typeof sections === "object" ? sections : { "Serialized request": payload }).map(([title, content]) => ({ title, content }));
    const stableHash = firstValue(current.input?.prefix_sha256, current.input?.prefix_hash, current.detail?.prefix_hash, current.output?.prefix_hash);
    const tailHash = firstValue(current.input?.tail_sha256, current.input?.tail_hash, current.detail?.tail_hash, current.output?.tail_hash);
    const label = selectedMode().cache ? "Repeated local prefix preview" : "Stable instructions and tool schema";
    list.forEach((section, index) => {
      const title = section.title || section.name || section.section || `Prompt section ${index + 1}`;
      const hasBoundarySections = list.length === 4;
      const block = node("article", `assembly-block ${index === 0 ? "reused" : index === 1 && !hasBoundarySections || index === 2 && hasBoundarySections ? "divergence" : ""}`);
      const stepLabel = index === 0 ? label : index === 1 ? (hasBoundarySections ? "VISIBLE CASE BOUNDARY" : "FIRST LOCAL DIVERGENCE") : index === 2 && hasBoundarySections ? "FIRST LOCAL DIVERGENCE" : `Assembly step ${index + 1}`;
      block.append(node("span", "step-label", stepLabel));
      block.append(node("strong", "", title));
      const content = section.content ?? section.text ?? section.value ?? section;
      block.append(node("pre", "", typeof content === "string" ? content : json(content)));
      ui.context.append(block);
    });
    const hashes = node("div", "assembly-block");
    hashes.append(node("span", "step-label", "Local serialization facts"));
    hashes.append(node("p", "", `Prefix version: ${safe(current.input?.prefix_version || current.detail?.prefix_version)} · prefix hash: ${safe(stableHash)}\nTail hash: ${safe(tailHash)}\nProvider cache matching remains provider-controlled.`));
    ui.context.append(hashes);
    const selector = node("label", "context-selector", "Inspect another request");
    const select = document.createElement("select");
    for (const event of reqs) {
      const option = document.createElement("option"); option.value = String(event.sequence); option.textContent = `#${event.sequence} · turn ${safe(event.turn_index)} · ${event.kind}`; option.selected = event.sequence === current.sequence; select.append(option);
    }
    select.addEventListener("change", () => { activeRequestSequence = Number(select.value); renderContext(); });
    selector.append(select); ui.context.prepend(selector);
    const inspect = node("details", "assembly-block"); inspect.append(node("summary", "", "Inspect safe serialized request payload")); inspect.append(node("pre", "", json(payload))); ui.context.append(inspect);
  }
  ui.history.replaceChildren();
  const historyEvents = events.filter((event) => ["user", "question", "answer", "response", "tool_result", "refetch"].includes(event.kind));
  if (!historyEvents.length) ui.history.append(node("p", "quiet-copy", "Original turns stay in the saved event history, including turns omitted from compacted model context."));
  for (const event of historyEvents) {
    const item = node("article", "history-item"); item.append(node("span", "step-label", `${event.kind.replaceAll("_", " ")} · turn ${safe(event.turn_index)}`)); item.append(node("p", "", eventText(event))); ui.history.append(item);
  }
  const checkpointEvent = events.find((event) => event.kind === "checkpoint");
  ui.checkpoint.replaceChildren();
  if (!checkpointEvent) ui.checkpoint.append(node("p", "quiet-copy", "No checkpoint recorded for this run, or the selected variant retains full history."));
  else {
    const data = checkpointEvent.output || checkpointEvent.detail || {};
    const fields = [["Decision", data.decision], ["Confidence / uncertainty", data.confidence ?? data.uncertainty], ["Unresolved question", data.unresolved_question], ["Customer constraints", data.constraints], ["Policy source", `${safe(data.document_id)} ${data.version ? `v${data.version}` : ""}`.trim()], ["Passages and qualifier to retain", data.passages || data.qualifier || data.evidence_to_retain], ["Refetch needed", data.refetch_needed], ["Checkpoint provenance", checkpointEvent.sequence ? `Event ${checkpointEvent.sequence}; original source events remain intact.` : null]];
    const dl = document.createElement("dl"); fields.forEach(([term, value]) => { dl.append(node("dt", "", term), node("dd", "", typeof value === "object" ? json(value) : safe(value))); }); ui.checkpoint.append(dl);
  }
  const refetch = events.find((event) => /refetch|tool_result/i.test(event.kind));
  ui.refetchButton.disabled = !runData;
  ui.refetchPanel?.classList.toggle("has-refetch", Boolean(refetch));
  const result = $("#refetch-result"); result.replaceChildren();
  if (refetch) {
    const output = refetch.output || {};
    const card = node("div", "refetch-result-card", `${safe(output.document_id)} ${output.version ? `v${output.version}` : ""} · ${safe(output.passage_id || refetch.input?.passage_id)}\n${output.text || output.content || eventText(refetch)}`);
    result.append(card);
  } else result.textContent = "The scripted follow-up may record its refetch event here.";
}

function summaryOf(item) { return item.summary || item.metrics || item; }
function renderComparison() {
  ui.comparison.replaceChildren();
  if (!runs.length) { ui.comparison.append(node("p", "quiet-copy", "No saved variants yet. Missing usage remains unknown; it is never rendered as zero.")); return; }
  const comparableRuns = runs.filter((item) => !["INVALID", "STOPPED"].includes(String(item.status || "").toUpperCase()));
  if (runs.some((item) => ["INVALID", "STOPPED"].includes(String(item.status || "").toUpperCase()))) {
    ui.comparison.append(node("p", "quiet-copy", "Stopped or invalid runs are excluded from this comparison; their event trails remain available."));
  }
  for (const item of comparableRuns) {
    const mode = item.mode || item.variant_mode || "unknown";
    const summary = summaryOf(item);
    const row = node("div", "comparison-row");
    row.append(node("span", "", MODES[mode]?.label || mode));
    const bar = node("span", "bar"); const fill = node("i");
    const cost = summary.cost_usd ?? summary.derived_cost_usd ?? summary.spend_usd ?? summary.spend_estimate_usd;
    const maxCost = Math.max(0.000001, ...comparableRuns.map((run) => Number(summaryOf(run).cost_usd ?? summaryOf(run).derived_cost_usd ?? summaryOf(run).spend_usd ?? summaryOf(run).spend_estimate_usd) || 0));
    fill.style.width = typeof cost === "number" ? `${Math.max(3, cost / maxCost * 100)}%` : "0%"; bar.append(fill); row.append(bar);
    row.append(node("strong", "", usd(cost))); ui.comparison.append(row);
  }
  const note = node("p", "quiet-copy", "Per variant · derived cost estimate. Provider cache accounting is displayed separately in the ledger."); ui.comparison.append(note);
}

function updateMetrics() {
  const summary = summaryOf(runData?.run || runData || {});
  const events = runData?.events || [];
  const responses = events.filter((event) => event.kind === "response" || event.output?.usage);
  const totalInput = responses.reduce((sum, event) => sum + (typeof getUsage(event).input_tokens === "number" ? getUsage(event).input_tokens : 0), 0);
  const hasInput = responses.length > 0 && responses.every((event) => typeof getUsage(event).input_tokens === "number");
  const durations = responses.reduce((sum, event) => sum + (typeof event.duration_ms === "number" ? event.duration_ms : 0), 0);
  const hasDuration = responses.some((event) => typeof event.duration_ms === "number");
  ui.metricCost.textContent = usd(summary.cost_usd ?? summary.derived_cost_usd ?? runData?.experiment?.spend_usd ?? runData?.spend_usd);
  ui.metricInput.textContent = hasInput ? num(totalInput, 0) : "unknown";
  ui.metricLatency.textContent = hasDuration ? duration(durations) : "unknown";
  ui.metricCheckpoint.textContent = events.some((event) => event.kind === "checkpoint") ? "Recorded" : "None / unknown";
  const runSpend = runData?.experiment?.spend_usd ?? runData?.spend_usd;
  const cap = runData?.experiment?.budget_cap_usd ?? metadata?.budget_cap_usd;
  ui.remaining.textContent = typeof runSpend === "number" && typeof cap === "number" ? usd(Math.max(0, cap - runSpend)) : usd(metadata?.budget_cap_usd ?? 0.25);
}

function renderRun() {
  const run = runData?.run || runData?.variant || runData || {};
  const id = run.variant_id || run.run_id || activeVariantId;
  const mode = run.mode || run.variant_mode;
  ui.runTitle.textContent = blindReview && id ? "Blind review · mode hidden" : id ? `${MODES[mode]?.label || mode || "Experiment"} · ${String(id).slice(0, 8)}` : "Choose a mode and check the budget";
  ui.runSubtitle.textContent = blindReview ? "Review the same scripted turns against policy evidence. The selected mode and run list are hidden." : id ? `Saved local experiment · ${safe(run.status, "status unavailable")} · ${safe(run.model || runData?.experiment?.model, "gpt-6-luna")}` : "Synthetic scenario details are visible before any request starts.";
  ui.runStatus.textContent = safe(run.status, "READY").toUpperCase();
  ui.runStatus.classList.toggle("running", String(run.status).toUpperCase() === "RUNNING");
  ui.conversationLabel.textContent = blindReview && id ? "Blind review · fixed question sequence" : id ? `${MODES[mode]?.label || mode || "Experiment"} · fixed question sequence` : "No run selected";
  const hasRun = Boolean(id);
  ui.replay.disabled = !hasRun; ui.export.disabled = !hasRun; ui.retry.disabled = !hasRun;
  renderConversation(); renderLedger(); renderContext(); updateMetrics(); renderRunList();
  document.querySelector(".setup-panel").classList.toggle("blind-hidden", blindReview);
  document.querySelector(".saved-panel").classList.toggle("blind-hidden", blindReview);
  document.querySelector(".comparison > section:first-child").classList.toggle("blind-hidden", blindReview);
  $("#blind-toggle").setAttribute("aria-pressed", String(blindReview));
  $("#blind-toggle").textContent = blindReview ? "Show mode labels" : "Hide mode labels";
  loadQualityReview(runData?.variant?.quality_review || run.quality_review);
}

function loadQualityReview(review = {}) {
  const form = $("#quality-form");
  if (!form) return;
  for (const field of ["correct_answer", "correct_citation", "qualifier_preserved", "refetch_behavior_correct", "unsupported_claims"]) {
    form.elements[field].checked = review[field] === true;
  }
  form.elements.notes.value = review.notes || "";
  $("#save-quality").disabled = !activeVariantId;
}
async function saveQualityReview(event) {
  event.preventDefault();
  if (!activeVariantId) return;
  const form = $("#quality-form");
  const review = Object.fromEntries(["correct_answer", "correct_citation", "qualifier_preserved", "refetch_behavior_correct", "unsupported_claims"].map((key) => [key, form.elements[key].checked]));
  review.notes = form.elements.notes.value.trim();
  const button = $("#save-quality"); button.disabled = true; button.textContent = "Saving review…";
  try {
    const saved = await requestJSON(`/api/cache-lab/runs/${encodeURIComponent(activeVariantId)}/quality`, { method: "POST", body: JSON.stringify(review) });
    $("#quality-status").textContent = "Human review saved with this local variant. It is not an automated quality score.";
    if (saved?.variant?.quality_review) { runData.variant = saved.variant; }
    else { await selectRun(activeVariantId); }
  } catch (error) { $("#quality-status").textContent = `Review could not be saved: ${error.message}`; }
  finally { button.disabled = !activeVariantId; button.textContent = "Save local quality review"; }
}
async function refetchPassage() {
  if (!activeVariantId) return;
  const passageId = $("#refetch-passage-id").value.trim();
  if (!passageId) { $("#refetch-result").textContent = "Enter a passage ID from the displayed synthetic corpus."; return; }
  ui.refetchButton.disabled = true; ui.refetchButton.textContent = "Fetching local passage…";
  try {
    const result = await requestJSON(`/api/cache-lab/runs/${encodeURIComponent(activeVariantId)}/refetch`, { method: "POST", body: JSON.stringify({ passage_id: passageId }) });
    const passage = result.passage || result.result || result;
    const card = node("div", "refetch-result-card", `${safe(passage.document_id)} ${passage.version ? `v${passage.version}` : ""} · ${safe(passage.passage_id)}\n${safe(passage.text, "Passage text was not returned.")}`);
    $("#refetch-result").replaceChildren(card);
    $("#quality-status").textContent = "Local fixture passage refetched. No model request was made.";
    await selectRun(activeVariantId);
  } catch (error) { $("#refetch-result").textContent = `Refetch failed: ${error.message}`; }
  finally { ui.refetchButton.disabled = !activeVariantId; ui.refetchButton.textContent = "Refetch cited passage"; }
}

function renderRunList() {
  ui.runList.replaceChildren();
  if (!runs.length) { ui.runList.append(node("p", "quiet-copy", "No saved API experiments yet.")); return; }
  for (const run of runs) {
    const id = run.variant_id || run.run_id || run.id;
    if (!id) continue;
    const button = node("button", `run-item ${id === activeVariantId ? "selected" : ""}`);
    button.type = "button";
    button.append(node("strong", "", `${MODES[run.mode]?.label || run.mode || "Experiment"} · ${safe(run.status, "SAVED")}`));
    button.append(node("span", "", `${safe(run.created_at || run.started_at)} · ${String(id).slice(0, 8)}`));
    button.addEventListener("click", () => selectRun(id)); ui.runList.append(button);
  }
  renderComparison();
}

async function refreshRuns() {
  try {
    const body = await requestJSON("/api/cache-lab/runs");
    runs = body.runs || body.variants || [];
    renderRunList();
  } catch (error) { setNotice(`Saved experiments could not load: ${error.message}`, true); }
}
async function selectRun(id) {
  try {
    const body = await requestJSON(`/api/cache-lab/runs/${encodeURIComponent(id)}`);
    activeVariantId = id; runData = body; activeRequestSequence = null; renderRun();
    document.querySelector('[aria-controls="view-conversation"]').click();
  } catch (error) { setNotice(`Experiment could not load: ${error.message}`, true); }
}
async function startRun() {
  if (!preflight || !preflightAllowed(preflight) || !ui.ack.checked) { setNotice("Run preflight and acknowledge the displayed budget before starting.", true); return; }
  ui.start.disabled = true; ui.start.textContent = "Running paid experiment…"; setNotice("The paid run is in progress. The page waits for the backend to finish and save the event history.");
  try {
    const body = await requestJSON("/api/cache-lab/runs", { method: "POST", body: JSON.stringify({ mode: ui.mode.value, output_token_cap: capValue(), acknowledged_budget: true }) });
    const run = body.run || body.variant || body;
    activeVariantId = run.variant_id || run.run_id || run.id;
    if (body.events) runData = body;
    else if (activeVariantId) runData = await requestJSON(`/api/cache-lab/runs/${encodeURIComponent(activeVariantId)}`);
    setNotice("The run finished or stopped. All recorded events, including any budget stop, remain available for replay.");
    await refreshRuns(); renderRun(); await loadMetadata();
  } catch (error) { setNotice(`Run stopped: ${error.message}`, true); await refreshRuns(); }
  finally { ui.start.textContent = "Start paid run →"; clearPreflight(); }
}
async function replayRun() {
  if (!activeVariantId) return;
  try {
    runData = await requestJSON(`/api/cache-lab/runs/${encodeURIComponent(activeVariantId)}/replay`);
    setNotice("Read-only replay loaded from saved events. No provider request was made."); renderRun();
  } catch (error) { setNotice(`Replay failed: ${error.message}`, true); }
}
async function exportRun() {
  if (!activeVariantId) return;
  try {
    const response = await fetch(`/api/cache-lab/runs/${encodeURIComponent(activeVariantId)}/export?format=json`);
    if (!response.ok) { const body = await response.json().catch(() => ({})); throw new Error(body.detail || `Export failed (${response.status}).`); }
    const blob = await response.blob(); const url = URL.createObjectURL(blob); const link = document.createElement("a");
    link.href = url; link.download = `cache-lab-${String(activeVariantId).slice(0, 8)}.json`; document.body.append(link); link.click(); link.remove(); URL.revokeObjectURL(url);
    setNotice("Sanitized local JSON export downloaded. Review and scrub any real user content before sharing it.");
  } catch (error) { setNotice(`Export failed: ${error.message}`, true); }
}
function newAttempt() {
  const run = runData?.run || runData?.variant || runData || {};
  const mode = run.mode || run.variant_mode;
  if (MODES[mode]) ui.mode.value = mode;
  document.querySelector('[aria-controls="view-conversation"]').click();
  clearPreflight(); ui.ack.checked = false; ui.preflightButton.focus();
  setNotice("This creates a separate paid attempt. Check its current preflight, then acknowledge the estimate before starting.");
}

document.querySelectorAll(".view-tab").forEach((tab) => tab.addEventListener("click", () => {
  document.querySelectorAll(".view-tab").forEach((item) => { item.classList.toggle("active", item === tab); item.setAttribute("aria-selected", String(item === tab)); });
  document.querySelectorAll(".view-panel").forEach((panel) => { const selected = panel.id === tab.getAttribute("aria-controls"); panel.hidden = !selected; panel.classList.toggle("active", selected); });
}));
ui.mode.addEventListener("change", () => { updateModeText(); clearPreflight(); });
ui.cap.addEventListener("input", clearPreflight);
ui.preflightButton.addEventListener("click", checkPreflight);
ui.ack.addEventListener("change", updateStartState);
ui.start.addEventListener("click", startRun);
ui.refreshRuns.addEventListener("click", refreshRuns);
ui.replay.addEventListener("click", replayRun);
ui.export.addEventListener("click", exportRun);
ui.retry.addEventListener("click", newAttempt);
$("#refetch-button").addEventListener("click", refetchPassage);
$("#quality-form").addEventListener("submit", saveQualityReview);
$("#blind-toggle").addEventListener("click", () => { blindReview = !blindReview; renderRun(); });
async function boot() {
  updateModeText(); ui.cap.max = "500"; ui.cap.min = "1"; await Promise.all([loadMetadata(), refreshRuns()]);
}
boot();
