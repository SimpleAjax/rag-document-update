const $ = (selector) => document.querySelector(selector);

const ui = {
  themeToggle: $(".theme-toggle"),
  sourceNote: $("#source-note"),
  sourceList: $("#source-list"),
  sourceCount: $("#source-count"),
  jobList: $("#job-list"),
  liveButton: $("#live-button"),
  stepButton: $("#step-button"),
  notice: $("#notice"),
  runTitle: $("#run-title"),
  runSubtitle: $("#run-subtitle"),
  runStatus: $("#run-status"),
  runControls: $("#run-controls"),
  runJobId: $("#run-job-id"),
  continueButton: $("#continue-button"),
  stopButton: $("#stop-button"),
  returnCurrent: $("#return-current"),
  exitReplay: $("#exit-replay"),
  previousEvent: $("#previous-event"),
  nextEvent: $("#next-event"),
  timeline: $("#stage-timeline"),
  detail: $("#stage-detail"),
  searchForm: $("#search-form"),
  searchQuestion: $("#search-question"),
  searchStatus: $("#search-status"),
  searchResults: $("#search-results"),
  searchVersions: $("#search-versions"),
  cosineList: $("#cosine-list"),
  rerankList: $("#rerank-list"),
  selectedPassages: $("#selected-passages"),
  searchTextSize: $("#search-text-size"),
  searchSourceNote: $("#search-source-note"),
};

const terminalRunStates = new Set(["READY", "FAILED", "ALREADY_READY"]);
const activeRunStates = new Set(["STARTING", "RUNNING", "PAUSED", "STOPPING"]);
const pipelineStages = ["VALIDATING", "CHUNKING", "EMBEDDING", "INDEXING", "READY"];
const stateDescriptions = {
  PENDING: "The job record exists. Source metadata has passed its initial check.",
  VALIDATING: "The parser checked the source metadata and calculated its SHA-256 hash.",
  CHUNKING: "The splitter made the passages that the search tool can return.",
  EMBEDDING: "The local model made one 384-value vector for each passage.",
  INDEXING: "The passages are ready. The final database transaction has not started.",
  READY: "PostgreSQL committed the passages and made this version active.",
  FAILED: "The run stopped. The previous active version stays in place.",
};

let sources = [];
let selectedSourcePath = null;
let jobs = [];
let activeRun = null;
let selectedJob = null;
let currentJobDetail = null;
let selectedSequence = null;
let followLatest = true;
let replayMode = false;
let pollHandle = null;
let pollBusy = false;
let latestSearch = null;

function syncThemeToggle() {
  const dark = document.documentElement.dataset.theme === "dark";
  ui.themeToggle.setAttribute("aria-pressed", String(dark));
  ui.themeToggle.setAttribute("aria-label", dark ? "Switch to light mode" : "Switch to dark mode");
  ui.themeToggle.title = dark ? "Light mode" : "Dark mode";
}

function toggleTheme() {
  const nextTheme = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  document.documentElement.dataset.theme = nextTheme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", nextTheme === "dark" ? "#11161A" : "#F9F9F8");
  try {
    localStorage.setItem("cimulink-theme", nextTheme);
  } catch {
    // Keep the selected theme for this page even if storage is unavailable.
  }
  syncThemeToggle();
}

function node(tag, className, text) {
  const item = document.createElement(tag);
  if (className) item.className = className;
  if (text !== undefined && text !== null) item.textContent = String(text);
  return item;
}

function setNotice(message, kind = "info") {
  ui.notice.hidden = !message;
  ui.notice.className = kind === "error" ? "notice notice-error" : "notice";
  ui.notice.textContent = message || "";
}

async function requestJSON(url, options = {}) {
  const response = await fetch(url, {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options,
  });
  let body = {};
  try { body = await response.json(); } catch { body = {}; }
  if (!response.ok) throw new Error(body.detail || `Request failed (${response.status}).`);
  return body;
}

function formatTime(iso) {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(date);
}

function formatDuration(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  if (value < 1000) return `${Math.round(value)} ms`;
  return `${(value / 1000).toFixed(2)} s`;
}

function renderSearchRankList(items, stage) {
  const list = stage === "cosine" ? ui.cosineList : ui.rerankList;
  list.replaceChildren();
  if (!items.length) {
    list.append(node("p", "quiet-copy", "No active ready passages were available to rank."));
    return;
  }
  for (const item of items) {
    const row = node("button", "rank-row");
    row.type = "button";
    row.setAttribute("aria-label", `${item.passage_id}, cosine rank ${item.cosine_rank}, rerank rank ${item.rerank_rank}`);
    row.addEventListener("click", () => {
      const passage = ui.selectedPassages.querySelector(`[data-passage="${CSS.escape(item.passage_id)}"]`);
      if (passage) {
        passage.open = true;
        passage.scrollIntoView({ behavior: "smooth", block: "nearest" });
      }
    });
    const rank = node("span", "rank-number", stage === "cosine" ? item.cosine_rank : item.rerank_rank);
    const content = node("span", "rank-content");
    content.append(node("strong", "rank-id", item.passage_id));
    content.append(node("span", "rank-excerpt", item.text.slice(0, 180) + (item.text.length > 180 ? "…" : "")));
    const metrics = node("span", "rank-metrics");
    metrics.append(node("span", "rank-score", stage === "cosine" ? `cosine ${item.cosine_score.toFixed(4)}` : `rerank ${item.rerank_score.toFixed(6)}`));
    metrics.append(node("span", "rank-shift", `${item.cosine_rank} → ${item.rerank_rank}`));
    row.append(rank, content, metrics);
    list.append(row);
  }
}

function renderSearchResult(result) {
  latestSearch = result;
  ui.searchResults.hidden = false;
  const selectedSourceValue = selectedSource();
  ui.searchVersions.textContent = result.active_versions.length
    ? result.active_versions.map((item) => `${item.document_id} v${item.version}`).join(" · ")
    : "No active versions";
  ui.searchStatus.textContent = `${result.message} Searched the current active corpus for: “${result.query}”`;
  const rerankedById = new Map(result.reranked_candidates.map((item) => [item.passage_id, item]));
  const cosineWithRerank = result.cosine_candidates.map((item) => ({ ...item, rerank_rank: rerankedById.get(item.passage_id)?.rerank_rank }));
  renderSearchRankList(cosineWithRerank, "cosine");
  renderSearchRankList(result.reranked_candidates, "rerank");
  ui.selectedPassages.replaceChildren();
  const totalCharacters = result.results.reduce((total, item) => total + item.text.length, 0);
  ui.searchTextSize.textContent = `${result.results.length} passage${result.results.length === 1 ? "" : "s"} · ${totalCharacters.toLocaleString()} passage-text characters · ${result.tool_result_characters.toLocaleString()} tool JSON characters`;
  if (!result.results.length) {
    ui.selectedPassages.append(node("p", "quiet-copy", "No passage cleared the local rerank selection floor. The candidate trail above remains available for inspection."));
  }
  for (const item of result.results) {
    const article = node("details", "selected-passage");
    article.dataset.passage = item.passage_id;
    const summary = node("summary", "selected-passage-summary");
    const heading = node("div", "selected-passage-heading");
    heading.append(node("strong", "rank-id", item.passage_id));
    heading.append(node("span", "selected-source", `${item.document_id} v${item.version}`));
    const detail = result.reranked_candidates.find((candidate) => candidate.passage_id === item.passage_id);
    if (detail) heading.append(node("span", "selected-ranks", `cosine #${detail.cosine_rank} → rerank #${detail.rerank_rank}`));
    summary.append(heading, node("span", "selected-passage-action", "Show full passage"));
    article.append(summary, node("p", "selected-passage-text", item.text));
    ui.selectedPassages.append(article);
  }
  if (selectedSourceValue && (!selectedSourceValue.active || selectedSourceValue.database_status !== "READY")) {
    ui.searchSourceNote.textContent = `Pending source: ${selectedSourceValue.source_path} is not active. This question searched the current active corpus shown above.`;
  } else if (selectedSourceValue) {
    ui.searchSourceNote.textContent = `The selected source ${selectedSourceValue.source_path} is active only if listed in the versions above; the question always searches current active versions.`;
  } else {
    ui.searchSourceNote.textContent = "A source selected for ingestion does not change this search. Only active, ready versions appear above.";
  }
}

async function submitSearch(event) {
  event.preventDefault();
  const question = ui.searchQuestion.value.trim();
  if (!question) {
    ui.searchStatus.textContent = "Enter a policy question before searching.";
    ui.searchQuestion.focus();
    return;
  }
  ui.searchStatus.textContent = "Searching the current active corpus…";
  ui.searchResults.hidden = true;
  const button = ui.searchForm.querySelector("button[type=submit]");
  button.disabled = true;
  try {
    renderSearchResult(await requestJSON("/api/search", {
      method: "POST",
      body: JSON.stringify({ question }),
    }));
  } catch (error) {
    ui.searchStatus.textContent = error.message;
  } finally {
    button.disabled = false;
  }
}

function activeRunExists() {
  return activeRun && activeRunStates.has(activeRun.status);
}

function selectedSource() {
  return sources.find((source) => source.source_path === selectedSourcePath);
}

function updateSourceNote() {
  const source = selectedSource();
  if (!source) {
    ui.sourceNote.textContent = "Select a source to begin.";
    ui.liveButton.disabled = true;
    ui.stepButton.disabled = true;
    return;
  }
  if (!source.valid) {
    ui.sourceNote.textContent = source.error || "This source is invalid.";
    ui.liveButton.disabled = true;
    ui.stepButton.disabled = true;
    return;
  }
  if (source.source_bytes > 65536) {
    ui.sourceNote.textContent = "This lab accepts files up to 64 KiB.";
    ui.liveButton.disabled = true;
    ui.stepButton.disabled = true;
    return;
  }
  if (source.active && source.source_matches_database) {
    ui.sourceNote.textContent = `Active version · v${source.version}. This source is already indexed.`;
  } else if (source.database_status === "READY" && source.source_matches_database) {
    ui.sourceNote.textContent = `Already ingested · v${source.version}. No new job will be created.`;
  } else if (source.database_status && !source.source_matches_database) {
    ui.sourceNote.textContent = "This file differs from the stored version. Use a new version number.";
  } else {
    ui.sourceNote.textContent = `New source · ${source.document_id} v${source.version} · ${source.source_bytes.toLocaleString()} bytes.`;
  }
  const canStart = !activeRunExists() && !replayMode;
  ui.liveButton.disabled = !canStart;
  ui.stepButton.disabled = !canStart;
}

function renderSourceList() {
  ui.sourceList.replaceChildren();
  ui.sourceCount.textContent = String(sources.length).padStart(2, "0");
  if (!sources.length) {
    ui.sourceList.append(node("p", "quiet-copy", "No Markdown policy files were found."));
    return;
  }
  for (const source of sources) {
    const button = node("button", "source-item");
    button.type = "button";
    button.dataset.source = source.source_path;
    if (source.source_path === selectedSourcePath) button.classList.add("selected");
    button.disabled = activeRunExists();
    const heading = node("span", "source-item-title");
    heading.append(node("span", "", source.valid ? source.title : source.source_path));
    const state = !source.valid ? "INVALID" : source.active ? "ACTIVE" : source.database_status === "READY" ? "READY" : "NEW";
    const badge = node("span", `mini-status${source.active ? " mini-active" : ""}`, state);
    heading.append(badge);
    button.append(heading);
    const meta = source.valid
      ? `${source.document_id} · v${source.version}`
      : (source.error || "Source could not be read");
    button.append(node("span", "source-item-meta", meta));
    button.addEventListener("click", () => {
      if (replayMode) exitReplay();
      selectedSourcePath = source.source_path;
      updateSourceNote();
      renderSourceList();
      renderJob();
    });
    ui.sourceList.append(button);
  }
}

async function loadSources() {
  try {
    const data = await requestJSON("/api/sources");
    sources = data.sources || [];
    if (!sources.some((source) => source.source_path === selectedSourcePath)) {
      selectedSourcePath = sources.find((source) => source.valid && source.active)?.source_path
        || sources.find((source) => source.valid)?.source_path
        || null;
    }
    updateSourceNote();
    renderSourceList();
  } catch (error) {
    setNotice(error.message, "error");
    ui.sourceList.replaceChildren(node("p", "quiet-copy", "Could not load policy files."));
  }
}

function updateRunStatus(status, mode = "", replay = false) {
  const normalized = status || "READY WHEN YOU ARE";
  const classStatus = normalized === "PAUSED" ? "paused"
    : normalized === "FAILED" ? "failed"
      : normalized === "READY" || normalized === "ALREADY_READY" ? "ready"
        : activeRunStates.has(normalized) ? "running" : "idle";
  let label = normalized.replaceAll("_", " ");
  if (replay) label = `REPLAY · ${label}`;
  else if (mode) label = `${mode} · ${label}`;
  if (normalized === "ALREADY_READY") label = "ALREADY INGESTED";
  ui.runStatus.className = `status-stamp status-${classStatus}`;
  ui.runStatus.replaceChildren(node("span", "status-dot"), node("span", "", label));
}

function updateControls() {
  const isActive = activeRunExists();
  const paused = activeRun?.status === "PAUSED";
  const hasRun = Boolean(activeRun || selectedJob);
  ui.runControls.hidden = !hasRun;
  ui.continueButton.hidden = replayMode || !paused;
  ui.stopButton.hidden = replayMode || !isActive;
  ui.returnCurrent.hidden = replayMode || followLatest || !activeRun?.job_id;
  ui.exitReplay.hidden = !replayMode;
  ui.previousEvent.hidden = !replayMode;
  ui.nextEvent.hidden = !replayMode;
  const source = selectedSource();
  const canStart = Boolean(source?.valid) && !isActive && !replayMode;
  ui.liveButton.disabled = !canStart;
  ui.stepButton.disabled = !canStart;
  renderSourceList();
  if (activeRun?.job_id) ui.runJobId.textContent = activeRun.job_id;
  else if (activeRun?.already_ready) ui.runJobId.textContent = "No new job was created";
  else if (selectedJob) ui.runJobId.textContent = selectedJob.job_id;
  else ui.runJobId.textContent = "Waiting for source validation";
}

function eventTitle(state) {
  return state === "FAILED" ? "Stopped" : state.charAt(0) + state.slice(1).toLowerCase();
}

function renderTimeline() {
  const events = currentJobDetail?.events || [];
  ui.timeline.replaceChildren();
  const hasTrail = events.length > 0;
  const viewedIndex = Math.max(0, events.findIndex((event) => event.sequence === selectedSequence));
  const liveHeadIndex = !replayMode && activeRun?.job_id === currentJobDetail?.job?.job_id
    ? events.findIndex((event) => event.sequence === activeRun.current_sequence)
    : -1;
  const currentIndex = liveHeadIndex >= 0 ? liveHeadIndex : viewedIndex;

  events.forEach((event, index) => {
    const isCurrent = index === currentIndex;
    const isAhead = index > currentIndex;
    const isViewed = event.sequence === selectedSequence;
    const button = node("button", "event-step");
    button.type = "button";
    if (index < currentIndex && event.state !== "FAILED") button.classList.add("completed");
    if (event.state === "FAILED") button.classList.add("failed");
    if (isCurrent) button.classList.add("current");
    if (isAhead) button.classList.add("upcoming");
    if (isViewed) button.classList.add("selected");
    button.setAttribute("aria-current", isCurrent ? "step" : "false");
    const viewLabel = isViewed && !isCurrent ? "Selected detail" : isCurrent ? "Current stage" : isAhead ? "Incoming stage" : "Completed stage";
    button.setAttribute("aria-label", `${viewLabel}: ${eventTitle(event.state)}, ${formatTime(event.occurred_at)}`);
    button.append(node("span", "event-index", index + 1));
    const labelBlock = node("span", "event-label-block");
    labelBlock.append(node("span", "event-label", eventTitle(event.state)));
    labelBlock.append(node("span", "event-time", formatTime(event.occurred_at)));
    button.append(labelBlock);
    button.addEventListener("click", () => {
      selectedSequence = event.sequence;
      followLatest = !replayMode && index === events.length - 1;
      renderTimeline();
      renderDetail();
      updateControls();
    });
    ui.timeline.append(button);
  });

  if (!hasTrail && !activeRun) {
    const empty = node("div", "timeline-empty");
    empty.append(node("span", "empty-rule"), node("span", "", "EVENT TRAIL"), node("span", "empty-rule"));
    ui.timeline.append(empty);
    return;
  }

  if (!replayMode && activeRun && activeRunStates.has(activeRun.status)) {
    const lastState = activeRun.current_state || events.at(-1)?.state;
    const lastStageIndex = pipelineStages.indexOf(lastState);
    const nextStageIndex = lastState === "PENDING" ? 0 : lastStageIndex + 1;
    pipelineStages.slice(Math.max(0, nextStageIndex)).forEach((state, offset) => {
      const step = node("div", "event-step upcoming future-stage");
      step.setAttribute("aria-label", `Incoming stage: ${eventTitle(state)}`);
      step.append(node("span", "event-index", events.length + offset + 1));
      const labelBlock = node("span", "event-label-block");
      labelBlock.append(node("span", "event-label", eventTitle(state)));
      labelBlock.append(node("span", "event-time", "NOT STARTED"));
      step.append(labelBlock);
      ui.timeline.append(step);
    });
  }
}

function addDetailHeader(title, description, chip = "") {
  const header = node("header", "detail-header");
  const copy = node("div");
  copy.append(node("span", "section-kicker", "SAVED INGESTION DETAIL"));
  copy.append(node("h3", "detail-title", title));
  copy.append(node("p", "detail-copy", description));
  header.append(copy);
  if (chip) header.append(node("span", "detail-chip", chip));
  ui.detail.replaceChildren(header);
}

function addMetadata(items) {
  const grid = node("div", "metadata-grid");
  for (const [label, value, large = false] of items) {
    const item = node("div", "metadata-item");
    item.append(node("span", "metadata-label", label));
    item.append(node("span", `metadata-value${large ? " is-large" : ""}`, value ?? "—"));
    grid.append(item);
  }
  ui.detail.append(grid);
}

function addNote(text) {
  ui.detail.append(node("p", "detail-note", text));
}

function renderPending(payload, event) {
  addDetailHeader("The job is recorded", stateDescriptions.PENDING, `EVENT ${String(event.sequence).padStart(2, "0")}`);
  addMetadata([
    ["DOCUMENT", payload.document_id || selectedJob?.document_id || "—"],
    ["VERSION", payload.version ?? selectedJob?.version ?? "—"],
    ["RUN MODE", payload.run_mode || selectedJob?.mode || "—"],
    ["EVENT TIME", formatTime(event.occurred_at)],
  ]);
  addNote("The file passed its source check before this job row was created. The validation result is the next event.");
}

function renderValidation(payload, event) {
  addDetailHeader("Source checked and identified", stateDescriptions.VALIDATING, `EVENT ${String(event.sequence).padStart(2, "0")}`);
  addMetadata([
    ["DOCUMENT ID", payload.document_id],
    ["VERSION", `v${payload.version}`],
    ["SOURCE SIZE", `${Number(payload.source_bytes || 0).toLocaleString()} bytes`],
    ["CHECK TIME", formatDuration(payload.duration_ms)],
  ]);

  const validationLayout = node("div", "validation-layout");
  const hashPanel = node("section", "validation-hash-panel");
  const hashHeading = node("div", "panel-heading");
  hashHeading.append(node("h4", "", "SOURCE FINGERPRINT"));
  hashHeading.append(node("span", "", "SHA-256"));
  hashPanel.append(hashHeading);
  const hashValue = node("code", "validation-hash-value", payload.source_sha256 || "Unavailable");
  hashPanel.append(hashValue);
  hashPanel.append(node("p", "validation-hash-note", "Calculated from the exact file content. A content change produces a different hash."));

  const checksPanel = node("section", "validation-checks-panel");
  const checksHeading = node("div", "panel-heading");
  checksHeading.append(node("h4", "", "SOURCE CHECKS"));
  checksHeading.append(node("span", "", "PASSED BEFORE THIS STAGE"));
  checksPanel.append(checksHeading);
  const checks = [
    ["Allowed source", "Markdown file inside data/policies/"],
    ["File size", "Within the 64 KiB limit"],
    ["YAML front matter", "Parsed as valid metadata"],
    ["Document ID", "Matches the required ID format"],
    ["Version", "Positive integer; can be ingested"],
    ["Policy content", "Title and body are present"],
  ];
  const checkList = node("ul", "validation-check-list");
  for (const [title, detail] of checks) {
    const row = node("li", "validation-check");
    row.append(node("span", "validation-check-mark", "✓"));
    const copy = node("span", "validation-check-copy");
    copy.append(node("strong", "", title), node("span", "", detail));
    row.append(copy);
    checkList.append(row);
  }
  checksPanel.append(checkList);
  validationLayout.append(hashPanel, checksPanel);
  ui.detail.append(validationLayout);

  const source = node("pre", "source-snapshot", payload.source_text || "Source snapshot was not saved.");
  source.setAttribute("aria-label", "Exact policy source text used for this ingestion");
  ui.detail.append(source);
}

function createPassageCard(passage, index, documentId, version, overlapSetting) {
  const card = node("section", "passage-card");
  const head = node("div", "passage-card-head");
  const passageId = passage.passage_id || `${documentId}-v${version}-p${index + 1}`;
  head.append(node("code", "", passageId));
  head.append(node("span", "", `${Number(passage.character_count ?? passage.text?.length ?? 0).toLocaleString()} characters`));
  card.append(head);

  const text = passage.text || "";
  const actualOverlap = Math.min(Math.max(0, Number(passage.overlap_with_previous) || 0), text.length);
  const passageText = node("pre", "passage-text");
  passageText.setAttribute("aria-label", `Passage text. ${actualOverlap} leading characters highlighted as overlap with the previous passage.`);
  if (actualOverlap > 0) {
    const highlighted = node("mark", "overlap-highlight", text.slice(0, actualOverlap));
    highlighted.title = `${actualOverlap} characters repeated from the previous passage`;
    passageText.append(highlighted, document.createTextNode(text.slice(actualOverlap)));
  } else {
    passageText.textContent = text;
  }
  card.append(passageText);

  const overlapNote = node("div", "overlap-note");
  overlapNote.append(node("span", "overlap-setting", `${overlapSetting} CHAR OVERLAP SETTING`));
  const actualLabel = index === 0
    ? "No previous passage"
    : `${actualOverlap} characters repeated from previous passage`;
  overlapNote.append(node("span", "overlap-actual", actualLabel));
  card.append(overlapNote);
  return card;
}

function renderChunks(payload, event) {
  const passages = payload.passages || [];
  addDetailHeader("Passages made from the source", stateDescriptions.CHUNKING, `${passages.length} PASSAGES`);
  addMetadata([
    ["CHUNK LIMIT", `${payload.max_chars ?? 650} characters`],
    ["OVERLAP SETTING", `${payload.overlap_chars ?? 80} characters`],
    ["SPLIT TIME", formatDuration(payload.duration_ms)],
    ["EVENT TIME", formatTime(event.occurred_at)],
  ]);
  const list = node("div", "passage-list");
  const overlapSetting = payload.overlap_chars ?? 80;
  passages.forEach((passage, index) => list.append(createPassageCard(passage, index, selectedJob?.document_id, selectedJob?.version, overlapSetting)));
  ui.detail.append(list);
}

function vectorNorm(values) {
  return Math.sqrt(values.reduce((sum, value) => sum + value * value, 0));
}

function vectorColor(value, maxAbs) {
  const alpha = .08 + (Math.abs(value) / (maxAbs || 1)) * .8;
  const base = value >= 0 ? "70, 93, 106" : "131, 151, 165";
  return `rgba(${base}, ${alpha.toFixed(3)})`;
}

function renderVectorHeatmap(values) {
  const grid = node("div", "vector-grid");
  grid.setAttribute("role", "img");
  grid.setAttribute("aria-label", `Heatmap of ${values.length} actual embedding values, shown in order`);
  const maxAbs = Math.max(...values.map((value) => Math.abs(value)), 0);
  values.forEach((value, index) => {
    const cell = node("span", "vector-cell");
    cell.style.backgroundColor = vectorColor(value, maxAbs);
    cell.title = `Value ${index + 1}: ${Number(value).toFixed(6)}`;
    cell.setAttribute("aria-hidden", "true");
    grid.append(cell);
  });
  return grid;
}

function cosine(left, right) {
  const dot = left.reduce((sum, value, index) => sum + value * right[index], 0);
  const denominator = vectorNorm(left) * vectorNorm(right);
  return denominator ? dot / denominator : 0;
}

function renderSimilarityMatrix(passages) {
  const panel = node("section", "matrix-panel");
  const heading = node("div", "panel-heading");
  heading.append(node("h4", "", "PASSAGE SIMILARITY"));
  heading.append(node("span", "", "COSINE · COMPUTED FROM THESE VECTORS"));
  panel.append(heading);
  if (!passages.length || passages.some((passage) => !Array.isArray(passage.embedding))) {
    panel.append(node("p", "detail-note", "The saved run does not include vectors for every passage."));
    return panel;
  }
  const table = node("table", "similarity-table");
  const head = node("thead");
  const headerRow = node("tr");
  headerRow.append(node("th", "", "PASSAGE"));
  passages.forEach((_, index) => headerRow.append(node("th", "", `P${index + 1}`)));
  head.append(headerRow);
  table.append(head);
  const body = node("tbody");
  passages.forEach((rowPassage, rowIndex) => {
    const row = node("tr");
    row.append(node("th", "", `P${rowIndex + 1}`));
    passages.forEach((columnPassage, columnIndex) => {
      const score = cosine(rowPassage.embedding, columnPassage.embedding);
      const cell = node("td", "", score.toFixed(3));
      cell.title = `Passage ${rowIndex + 1} compared with passage ${columnIndex + 1}: cosine ${score.toFixed(6)}`;
      cell.style.backgroundColor = `rgba(131, 151, 165, ${(Math.max(0, score) * .2).toFixed(3)})`;
      row.append(cell);
    });
    body.append(row);
  });
  table.append(body);
  panel.append(table);
  return panel;
}

function renderEmbeddings(payload, event) {
  const passages = payload.passages || [];
  addDetailHeader("Actual vectors from the local model", stateDescriptions.EMBEDDING, `${payload.dimensions || 384} VALUES / PASSAGE`);
  addMetadata([
    ["MODEL", payload.model_name || "Local embedding model"],
    ["DIMENSIONS", payload.dimensions || 384],
    ["EMBED TIME", formatDuration(payload.duration_ms)],
    ["PASSAGES", passages.length],
  ]);
  if (!passages.length || !Array.isArray(passages[0].embedding)) {
    addNote("This saved event does not contain vector data.");
    return;
  }
  const selectRow = node("div", "passage-tabs");
  selectRow.setAttribute("role", "group");
  selectRow.setAttribute("aria-label", "Choose a passage embedding");
  passages.forEach((passage, index) => {
    const button = node("button", `passage-tab${index === 0 ? " selected" : ""}`, `P${index + 1}`);
    button.type = "button";
    button.addEventListener("click", () => {
      selectRow.querySelectorAll(".passage-tab").forEach((tab) => tab.classList.remove("selected"));
      button.classList.add("selected");
      renderSelectedVector(passage, index, payload, passages);
    });
    selectRow.append(button);
  });
  ui.detail.append(selectRow);
  renderSelectedVector(passages[0], 0, payload, passages);
  ui.detail.append(renderSimilarityMatrix(passages));
  addNote(`Event recorded at ${formatTime(event.occurred_at)}. The color shows the sign and relative size of each stored value within this vector.`);
}

function renderSelectedVector(passage, index, payload, allPassages) {
  const existing = ui.detail.querySelector(".embedding-layout");
  if (existing) existing.remove();
  const values = passage.embedding;
  if (!Array.isArray(values)) return;
  const max = Math.max(...values);
  const min = Math.min(...values);
  const panel = node("div", "embedding-layout");
  const visual = node("section", "vector-panel");
  const heading = node("div", "panel-heading");
  heading.append(node("h4", "", `PASSAGE ${index + 1} · ${passage.passage_id || `${selectedJob?.document_id}-v${selectedJob?.version}-p${index + 1}`}`));
  heading.append(node("span", "", "24 ROWS × 16 VALUES"));
  visual.append(heading, renderVectorHeatmap(values));
  const legend = node("div", "vector-legend");
  const pos = node("span");
  const posSwatch = node("span", "legend-swatch");
  posSwatch.style.background = "var(--slate-deep)";
  pos.append(posSwatch, document.createTextNode("positive"));
  const neg = node("span");
  const negSwatch = node("span", "legend-swatch");
  negSwatch.style.background = "var(--slate)";
  neg.append(negSwatch, document.createTextNode("negative"));
  legend.append(pos, neg);
  visual.append(legend);

  const info = node("section", "vector-info-panel");
  const infoHead = node("div", "panel-heading");
  infoHead.append(node("h4", "", "VECTOR VALUES"));
  infoHead.append(node("span", "", "REAL MODEL OUTPUT"));
  info.append(infoHead);
  const summary = node("div", "vector-summary");
  [["NORM", vectorNorm(values).toFixed(5)], ["RANGE", `${min.toFixed(4)} to ${max.toFixed(4)}`]].forEach(([label, value]) => {
    const stat = node("div", "vector-stat");
    stat.append(node("span", "", label), node("code", "", value));
    summary.append(stat);
  });
  info.append(summary);
  info.append(node("pre", "vector-peek", values.slice(0, 16).map((value, valueIndex) => `${String(valueIndex + 1).padStart(3, "0")}  ${Number(value).toFixed(7)}`).join("\n")));
  const details = node("details", "vector-expand");
  const summaryToggle = node("summary", "", `View all ${values.length} values`);
  details.append(summaryToggle);
  details.append(node("pre", "full-vector", values.map((value, valueIndex) => `${String(valueIndex + 1).padStart(3, "0")}  ${Number(value).toFixed(8)}`).join("\n")));
  info.append(details);
  panel.append(visual, info);
  const matrix = ui.detail.querySelector(".matrix-panel");
  const note = ui.detail.querySelector(".detail-note");
  const existingPanel = ui.detail.querySelector(".embedding-layout");
  if (existingPanel) existingPanel.replaceWith(panel);
  else if (matrix) ui.detail.insertBefore(panel, matrix);
  else if (note) ui.detail.insertBefore(panel, note);
  else ui.detail.append(panel);
}

function renderIndexing(payload, event) {
  addDetailHeader("Ready for the database write", stateDescriptions.INDEXING, "NOT COMMITTED YET");
  addMetadata([
    ["PASSAGE COUNT", payload.passage_count],
    ["CURRENT ACTIVE VERSION", payload.previous_active_version ? `v${payload.previous_active_version}` : "None"],
    ["NEW VERSION", `v${selectedJob?.version ?? "—"}`],
    ["EVENT TIME", formatTime(event.occurred_at)],
  ]);
  const panel = node("section", "commit-panel");
  const heading = node("div", "panel-heading");
  heading.append(node("h4", "", "PLANNED PASSAGE ROWS"));
  heading.append(node("span", "", "WRITE WAITS FOR CONTINUE IN STEP MODE"));
  panel.append(heading);
  const rows = node("div", "commit-rows");
  for (const id of payload.planned_passage_ids || []) {
    const row = node("div", "commit-row");
    row.append(node("span", "", "Passage ID"), node("code", "", id));
    rows.append(row);
  }
  panel.append(rows);
  panel.append(node("div", "commit-warning", "The passage rows and active version are not committed yet. Continue to run the final transaction."));
  ui.detail.append(panel);
}

function renderReady(payload, event) {
  addDetailHeader("The new version is active", stateDescriptions.READY, "COMMIT COMPLETE");
  addMetadata([
    ["PASSAGES COMMITTED", payload.passage_count ?? 0],
    ["PREVIOUS VERSION", payload.previous_active_version ? `v${payload.previous_active_version}` : "None"],
    ["ACTIVE VERSION", `v${payload.active_version ?? selectedJob?.version ?? "—"}`],
    ["READY TIME", formatTime(event.occurred_at)],
  ]);
  const panel = node("section", "commit-panel");
  const heading = node("div", "panel-heading");
  heading.append(node("h4", "", "PASSAGES NOW IN POSTGRESQL"));
  heading.append(node("span", "", "COMMITTED ROWS"));
  panel.append(heading);
  const rows = node("div", "commit-rows");
  for (const id of payload.passage_ids || []) {
    const row = node("div", "commit-row");
    row.append(node("span", "", "Stored passage"), node("code", "", id));
    rows.append(row);
  }
  panel.append(rows);
  ui.detail.append(panel);
}

function renderFailure(payload, event) {
  addDetailHeader("This attempt did not finish", stateDescriptions.FAILED, payload.category || "FAILED");
  addMetadata([
    ["LAST COMPLETE STAGE", payload.last_state || "—"],
    ["EVENT TIME", formatTime(event.occurred_at)],
    ["DOCUMENT", selectedJob?.document_id || "—"],
    ["VERSION", selectedJob ? `v${selectedJob.version}` : "—"],
  ]);
  const panel = node("div", "failure-panel");
  panel.append(node("strong", "", selectedJob?.error_message || activeRun?.error_message || "Ingestion failed."));
  panel.append(node("p", "", "The previous active version remains in place. Review the last saved stage, then start a new attempt after you correct the source or local setup."));
  ui.detail.append(panel);
}

function renderDetail() {
  const events = currentJobDetail?.events || [];
  const event = events.find((item) => item.sequence === selectedSequence) || events.at(-1);
  if (!event) {
    ui.detail.replaceChildren();
    const state = node("div", "empty-state");
    state.append(node("span", "section-kicker", activeRun?.already_ready ? "NO NEW INGESTION" : activeRun ? "WAITING FOR FIRST EVENT" : "SOURCE SELECTION"));
    state.append(node("h3", "", activeRun?.already_ready ? "This source is already indexed." : activeRun ? "The worker is preparing the source." : "Select a source and start a run."));
    state.append(node("p", "", activeRun?.detail || (activeRun ? "The page will show saved event data when the job starts." : "Choose a policy on the left, then select Run live or Step through.")));
    ui.detail.append(state);
    return;
  }
  const payload = event.payload || {};
  if (event.state === "PENDING") return renderPending(payload, event);
  if (event.state === "VALIDATING") return renderValidation(payload, event);
  if (event.state === "CHUNKING") return renderChunks(payload, event);
  if (event.state === "EMBEDDING") return renderEmbeddings(payload, event);
  if (event.state === "INDEXING") return renderIndexing(payload, event);
  if (event.state === "READY") return renderReady(payload, event);
  if (event.state === "FAILED") return renderFailure(payload, event);
  addDetailHeader(eventTitle(event.state), event.detail || "Saved event.", `EVENT ${event.sequence}`);
}

function renderJob() {
  const job = currentJobDetail?.job;
  if (job) {
    selectedJob = job;
    ui.runTitle.textContent = `${job.document_id} · v${job.version}`;
    ui.runSubtitle.textContent = `${job.mode} run · started ${formatTime(job.created_at)}${job.completed_at ? ` · finished ${formatTime(job.completed_at)}` : ""}`;
    ui.runJobId.textContent = job.job_id;
  } else if (activeRun) {
    const source = sources.find((item) => item.source_path === activeRun.source_path);
    ui.runTitle.textContent = source ? `${source.document_id} · v${source.version}` : activeRun.source_path;
    ui.runSubtitle.textContent = activeRun.detail || "Preparing ingestion.";
  } else {
    const source = selectedSource();
    ui.runTitle.textContent = source ? `${source.title} · v${source.version}` : "Choose a source to begin";
    ui.runSubtitle.textContent = source?.active
      ? "This version is already active. Select a newer source version to ingest it."
      : source ? "Choose Run live or Step through to start this source." : "Select a source file to begin.";
  }
  const status = replayMode ? (job?.status || "READY") : (activeRun?.status || job?.status || "READY WHEN YOU ARE");
  updateRunStatus(status, replayMode ? "" : activeRun?.mode, replayMode);
  const events = currentJobDetail?.events || [];
  if (followLatest && events.length) selectedSequence = events.at(-1).sequence;
  if (selectedSequence && !events.some((item) => item.sequence === selectedSequence)) {
    selectedSequence = events.length ? events.at(-1).sequence : null;
  }
  renderTimeline();
  renderDetail();
  updateControls();
}

function renderJobs() {
  ui.jobList.replaceChildren();
  if (!jobs.length) {
    ui.jobList.append(node("p", "quiet-copy", "Saved lab runs will appear here. Replay any run without starting ingestion again."));
    return;
  }
  for (const job of jobs) {
    const button = node("button", `job-item${selectedJob?.job_id === job.job_id && replayMode ? " selected" : ""}`);
    button.type = "button";
    const heading = node("span", "job-item-title");
    heading.append(node("span", "", `${job.document_id} · v${job.version}`));
    const badge = node("span", `mini-status${job.status === "READY" ? " mini-active" : ""}`, job.status);
    heading.append(badge);
    button.append(heading);
    button.append(node("span", "job-item-meta", `${job.mode} · ${formatTime(job.created_at)}`));
    button.addEventListener("click", () => openReplay(job.job_id));
    ui.jobList.append(button);
  }
}

async function refreshJobs() {
  try {
    const data = await requestJSON("/api/jobs");
    jobs = data.jobs || [];
    renderJobs();
  } catch (error) {
    setNotice(error.message, "error");
  }
}

async function startRun(mode) {
  const source = selectedSource();
  if (!source?.valid) return;
  clearInterval(pollHandle);
  activeRun = null;
  selectedJob = null;
  currentJobDetail = null;
  replayMode = false;
  selectedSequence = null;
  followLatest = true;
  setNotice(mode === "STEP" ? "Starting a step run. The first pause is after source validation." : "Starting live ingestion. The page will follow saved events.");
  try {
    activeRun = await requestJSON("/api/runs", {
      method: "POST",
      body: JSON.stringify({ source_path: source.source_path, mode }),
    });
    history.replaceState({}, "", `/?run=${encodeURIComponent(activeRun.run_id)}`);
    setNotice("");
    renderJob();
    await pollRun();
    if (activeRunExists()) pollHandle = setInterval(pollRun, 550);
  } catch (error) {
    setNotice(error.message, "error");
    activeRun = null;
    updateControls();
  }
}

async function pollRun() {
  if (pollBusy || !activeRun) return;
  pollBusy = true;
  try {
    activeRun = await requestJSON(`/api/runs/${activeRun.run_id}`);
    const savedEvents = currentJobDetail?.job?.job_id === activeRun.job_id
      ? (currentJobDetail.events || [])
      : [];
    const savedSequence = savedEvents.length ? savedEvents.at(-1).sequence : 0;
    const shouldReadJob = activeRun.job_id && (
      !currentJobDetail || currentJobDetail.job?.job_id !== activeRun.job_id ||
      terminalRunStates.has(activeRun.status) ||
      (activeRun.current_sequence || 0) > savedSequence
    );
    if (shouldReadJob) {
      currentJobDetail = await requestJSON(`/api/jobs/${activeRun.job_id}`);
      selectedJob = currentJobDetail.job;
    }
    renderJob();
    if (terminalRunStates.has(activeRun.status)) {
      clearInterval(pollHandle);
      await refreshJobs();
      await loadSources();
      if (activeRun) updateControls();
      if (activeRun.status === "FAILED") setNotice(activeRun.error_message || activeRun.detail, "error");
      else if (activeRun.status === "ALREADY_READY") setNotice(activeRun.detail);
      else setNotice("Ingestion is complete. Select a saved job to replay its stage trail.");
    }
  } catch (error) {
    clearInterval(pollHandle);
    setNotice(error.message, "error");
  } finally {
    pollBusy = false;
  }
}

async function continueRun() {
  if (!activeRun?.wait_sequence) return;
  const expected_sequence = activeRun.wait_sequence;
  try {
    activeRun = await requestJSON(`/api/runs/${activeRun.run_id}/continue`, {
      method: "POST",
      body: JSON.stringify({ expected_sequence }),
    });
    setNotice("");
    renderJob();
    if (!pollHandle) pollHandle = setInterval(pollRun, 550);
    await pollRun();
  } catch (error) {
    setNotice(error.message, "error");
    await pollRun();
  }
}

async function stopRun() {
  if (!activeRun) return;
  try {
    activeRun = await requestJSON(`/api/runs/${activeRun.run_id}/stop`, { method: "POST" });
    setNotice("Stop requested. The current model or database step will finish before the worker stops.");
    renderJob();
    if (!pollHandle) pollHandle = setInterval(pollRun, 550);
  } catch (error) {
    setNotice(error.message, "error");
  }
}

function exitReplay() {
  if (!replayMode) return;
  replayMode = false;
  selectedJob = null;
  currentJobDetail = null;
  selectedSequence = null;
  followLatest = true;
  history.replaceState({}, "", "/");
  renderJobs();
  renderJob();
}

async function openReplay(jobId) {
  clearInterval(pollHandle);
  replayMode = true;
  activeRun = null;
  selectedSequence = null;
  followLatest = true;
  try {
    currentJobDetail = await requestJSON(`/api/jobs/${jobId}`);
    selectedJob = currentJobDetail.job;
    history.replaceState({}, "", `/?job=${encodeURIComponent(jobId)}`);
    setNotice("Replay uses saved events and artifacts. It does not run ingestion.");
    renderJobs();
    renderJob();
  } catch (error) {
    exitReplay();
    setNotice(error.message, "error");
  }
}

function selectRelativeEvent(direction) {
  const events = currentJobDetail?.events || [];
  if (!events.length) return;
  const index = Math.max(0, events.findIndex((event) => event.sequence === selectedSequence));
  const nextIndex = Math.max(0, Math.min(events.length - 1, index + direction));
  selectedSequence = events[nextIndex].sequence;
  renderJob();
}

function returnToCurrent() {
  followLatest = true;
  const events = currentJobDetail?.events || [];
  selectedSequence = events.length ? events.at(-1).sequence : null;
  renderJob();
}

async function openFromUrl() {
  const params = new URLSearchParams(location.search);
  const runId = params.get("run");
  const jobId = params.get("job");
  if (jobId) return openReplay(jobId);
  if (runId) {
    try {
      activeRun = await requestJSON(`/api/runs/${runId}`);
      replayMode = false;
      await pollRun();
      if (activeRunExists()) pollHandle = setInterval(pollRun, 550);
    } catch (error) {
      history.replaceState({}, "", "/");
      setNotice(error.message, "error");
    }
  }
}

ui.themeToggle.addEventListener("click", toggleTheme);
ui.liveButton.addEventListener("click", () => startRun("LIVE"));
ui.stepButton.addEventListener("click", () => startRun("STEP"));
ui.continueButton.addEventListener("click", continueRun);
ui.stopButton.addEventListener("click", stopRun);
ui.exitReplay.addEventListener("click", exitReplay);
ui.returnCurrent.addEventListener("click", returnToCurrent);
ui.previousEvent.addEventListener("click", () => selectRelativeEvent(-1));
ui.nextEvent.addEventListener("click", () => selectRelativeEvent(1));
$("#refresh-history").addEventListener("click", refreshJobs);
ui.searchForm.addEventListener("submit", submitSearch);

async function boot() {
  syncThemeToggle();
  await loadSources();
  await refreshJobs();
  await openFromUrl();
  updateControls();
}

boot();
