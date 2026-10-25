// Dashboard: run an examination, render the record, chart lines and prescription,
// and hold a consultation with the examiner (Gemini or offline).

const CHART = [
  { logmar: 1.0, letters: "R" },
  { logmar: 0.8, letters: "EP" },
  { logmar: 0.6, letters: "OLE" },
  { logmar: 0.4, letters: "NSRE" },
  { logmar: 0.3, letters: "POLEN" },
  { logmar: 0.2, letters: "SREPO" },
  { logmar: 0.1, letters: "LENSR" },
  { logmar: 0.0, letters: "EPOLS" },
];
const CHART_BASE_PX = 13;
const DEFAULT_QUESTION = "Give me an initial review of this report and a prioritized fix plan.";

const state = {
  report: null,
  scannedAt: null,
  filter: "all",
  history: loadHistory(),
  activeCheckId: null,
  conversation: [],
  controller: null,
  insights: null,
  lastQuestion: DEFAULT_QUESTION,
  aiTimeout: 120,
  aiReady: false,
};

const $ = (selector) => document.querySelector(selector);
const elements = {
  form: $("#repoForm"),
  input: $("#repoUrl"),
  submit: $("#repoForm button[type=submit]"),
  formStatus: $("#formStatus"),
  progressWrap: $("#progressWrap"),
  progress: $("#analysisProgress"),
  progressMessage: $("#progressMessage"),
  progressPercent: $("#progressPercent"),
  targetBars: $("#targetBars"),
  chartRows: $("#chartRows"),
  chartCaption: $("#chartCaption"),
  record: $("#record"),
  lines: $("#lines"),
  rxSection: $("#rxSection"),
  grid: $("#checksGrid"),
  actionsList: $("#actionsList"),
  historyList: $("#historyList"),
  detail: $("#checkDetail"),
  panel: $("#assistantPanel"),
  launcher: $("#assistantLauncher"),
  chat: $("#assistantChat"),
  input2: $("#assistantInput"),
  send: $("#assistantSend"),
  connection: $("#aiConnection"),
  focus: $("#assistantFocus"),
  focusLabel: $("#assistantFocusLabel"),
  retry: $("#retryAi"),
  cancel: $("#cancelAi"),
  exportPlan: $("#exportWorkflow"),
};

const mode = () => document.querySelector("input[name=advisorMode]:checked").value;
const activeCheck = () => state.report?.checks.find((check) => check.id === state.activeCheckId) || null;

// --- Acuity chart ---------------------------------------------------------

function renderChart() {
  const reached = state.report ? acuity(state.report.score).logmar : null;
  elements.chartRows.innerHTML = CHART.map((row) => {
    const size = CHART_BASE_PX * 10 ** row.logmar;
    // Lines finer than the repository's acuity are out of focus, more so the further below.
    const blur = reached === null || row.logmar >= reached - 0.001 ? 0 : Math.min(6, (reached - row.logmar) * 14 * (size / 20) ** 0.3);
    const isLine = reached !== null && Math.abs(row.logmar - reached) < 0.001;
    return `<li class="chart-row${isLine ? " is-reached" : ""}" style="--k:${(10 ** row.logmar).toFixed(3)};--blur:${blur.toFixed(2)}px">
      <span class="chart-logmar">${row.logmar.toFixed(1)}</span>
      <span class="chart-letters" aria-hidden="true">${row.letters.split("").join(" ")}</span>
      <span class="chart-snellen">20/${SNELLEN[Math.round(row.logmar * 10)]}</span>
    </li>`;
  }).join("");
  if (state.report) {
    const sight = acuity(state.report.score);
    elements.chartCaption.innerHTML = `<strong>${escapeHtml(repoName(state.report))}</strong> reads to the <strong>${sight.snellen}</strong> line: ${sight.verdict.toLowerCase()}.`;
  }
}

// --- USAF-1951 style progress target: six elements of three bars, each finer --

function renderTarget(progress) {
  if (!elements.targetBars.childElementCount) {
    elements.targetBars.innerHTML = Array.from({ length: 6 }, (_, index) => `<span class="element" style="--scale:${(1 - index * 0.13).toFixed(2)}"><i></i><i></i><i></i></span>`).join("");
  }
  const lit = Math.floor((progress / 100) * 6 + 0.0001);
  [...elements.targetBars.children].forEach((element, index) => element.classList.toggle("is-lit", index < lit));
  elements.progress.value = progress;
  elements.progressPercent.textContent = `${progress}%`;
}

// --- Record, lines, prescription -----------------------------------------

function renderRecord() {
  const { report } = state;
  const tally = counts(report);
  const sight = acuity(report.score);
  $("#scoreValue").textContent = report.score;
  $("#acuityValue").textContent = sight.snellen;
  $("#logmarValue").textContent = sight.logmar.toFixed(1);
  $("#verdictValue").textContent = sight.verdict;
  $("#passCount").textContent = tally.pass;
  $("#warnCount").textContent = tally.warn;
  $("#failCount").textContent = tally.fail;
  $("#patchStrip").innerHTML = patchStrip(report);
  $("#recordSource").textContent = `Examined ${formatDate(state.scannedAt)}`;
  $("#specimenName").textContent = repoName(report);
  $("#specimenLink").href = `https://${report.root}`;
  const profile = report.profile || {};
  const rows = [];
  if (Number.isInteger(profile.files)) rows.push(["Files read", profile.files.toLocaleString()]);
  if (profile.languages?.length) rows.push(["Mostly", profile.languages.slice(0, 3).map((item) => `${item.ext} ×${item.count}`).join(" · ")]);
  if (profile.top_level?.length) rows.push(["Top level", `${profile.top_level.length} entries`]);
  $("#specimenMeta").innerHTML = rows.map(([term, value]) => `<div><dt>${escapeHtml(term)}</dt><dd>${escapeHtml(value)}</dd></div>`).join("");
}

function renderLines() {
  const { report } = state;
  const visible = report.checks.map((check, index) => ({ check, index })).filter(({ check }) => state.filter === "all" || check.status === state.filter);
  elements.grid.innerHTML = visible.map(({ check, index }) => `
    <li class="line line-${check.status}" style="--delay:${index * 45}ms">
      <button type="button" class="line-button" data-check-id="${escapeHtml(check.id)}" aria-haspopup="dialog">
        <span class="line-no">${String(index + 1).padStart(2, "0")}</span>
        <span class="line-optotype" aria-hidden="true">${escapeHtml(check.id[0].toUpperCase())}</span>
        <span class="line-text"><strong>${escapeHtml(check.title)}</strong><span>${escapeHtml(check.detail)}</span></span>
        <span class="line-id">${escapeHtml(check.id)}</span>
        ${statusMark(check.status)}
        <span class="line-open" aria-hidden="true"><svg><use href="#i-arrow"/></svg></span>
      </button>
    </li>`).join("") || '<li class="empty">No lines match this filter.</li>';
}

function renderPrescription() {
  elements.actionsList.innerHTML = prescription(state.report, state.scannedAt);
}

function renderSectionNumbers() {
  const hasReport = Boolean(state.report);
  $("#casesNo").textContent = hasReport ? "§ 04" : "§ 01";
  $("#methodNo").textContent = hasReport ? "§ 05" : "§ 02";
}

function render() {
  const hasReport = Boolean(state.report);
  [elements.record, elements.lines, elements.rxSection].forEach((section) => { section.hidden = !hasReport; });
  renderChart();
  renderSectionNumbers();
  if (hasReport) {
    renderRecord();
    renderLines();
    renderPrescription();
  }
  renderExaminer();
}

function renderMethod() {
  const titles = { readme: "README present and substantial", license: "LICENSE declared", gitignore: "Ignore file configured", tests: "Automated tests exist", ci: "Continuous integration configured", todos: "Unresolved TODO markers", "large-files": "No oversized files committed", secrets: "No hardcoded secrets" };
  $("#methodLines").innerHTML = Object.entries(CATALOGUE).map(([id, entry], index) => `
    <li><span class="line-no">${String(index + 1).padStart(2, "0")}</span><span class="method-optotype" aria-hidden="true">${id[0].toUpperCase()}</span><div><strong>${titles[id]}</strong> <code>${id}</code><p>${escapeHtml(entry.measures)}</p></div></li>`).join("");
}

// --- Case files -------------------------------------------------------------

function renderHistory() {
  if (!state.history.length) {
    elements.historyList.innerHTML = '<li class="empty">No examinations yet this session. Results stay in this browser tab only.</li>';
    $("#clearHistory").hidden = true;
    return;
  }
  $("#clearHistory").hidden = false;
  elements.historyList.innerHTML = state.history.map((entry) => `
    <li class="case">
      <button type="button" class="case-button" data-entry="${escapeHtml(entry.id)}">
        <span class="case-name">${escapeHtml(repoName(entry.report))}</span>
        <span class="case-date">${escapeHtml(formatDate(entry.scannedAt, { dateStyle: "short", timeStyle: "short" }))}</span>
        ${patchStrip(entry.report, { compact: true })}
        <span class="case-acuity">${acuity(entry.report.score).snellen}</span>
        <span class="case-score">${entry.report.score}</span>
      </button>
    </li>`).join("");
}

// --- Examination --------------------------------------------------------------

function selectReport(report, scannedAt = new Date().toISOString()) {
  state.controller?.abort();
  state.report = report;
  state.scannedAt = scannedAt;
  state.activeCheckId = null;
  state.conversation = [];
  state.insights = null;
  elements.exportPlan.disabled = true;
  render();
}

function setStatus(message, tone = "") {
  elements.formStatus.className = `form-status${tone ? ` is-${tone}` : ""}`;
  elements.formStatus.textContent = message;
}

// Jobs live in server memory, so a restart (deploy, idle spin-down) forgets them.
class JobLostError extends Error {}

async function pollJob(jobId) {
  const deadline = Date.now() + 190000;
  while (Date.now() < deadline) {
    const response = await fetch(`/api/report/${jobId}?ts=${Date.now()}`);
    const job = await response.json();
    if (response.status === 404) throw new JobLostError("The server restarted during the examination");
    if (!response.ok) throw new Error(job.error || "Examination job unavailable");
    renderTarget(job.progress);
    elements.progressMessage.textContent = job.message;
    if (job.state === "complete") return job.report;
    if (job.state === "error") throw new Error(job.error || job.message || "Examination failed");
    await new Promise((resolve) => setTimeout(resolve, 450));
  }
  throw new Error("The examination timed out after 190 seconds");
}

async function analyzeRepository(event) {
  event.preventDefault();
  const url = elements.input.value.trim();
  if (!url) {
    setStatus("Paste a public GitHub repository URL first.", "error");
    elements.input.focus();
    return;
  }
  if (elements.submit.disabled) return;
  elements.submit.disabled = true;
  elements.input.setAttribute("aria-busy", "true");
  setStatus("Examining. Each phase reports as it completes.", "loading");
  elements.progressWrap.hidden = false;
  elements.progressMessage.textContent = "Starting examination";
  renderTarget(2);
  try {
    const startExamination = async () => {
      const response = await fetch("/api/report", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url }) });
      const start = await response.json();
      if (!response.ok) throw new Error(start.error || "Could not start the examination");
      return pollJob(start.job_id);
    };
    let report;
    try {
      report = await startExamination();
    } catch (error) {
      if (!(error instanceof JobLostError)) throw error;
      setStatus("The server restarted mid-examination. Running it again.", "loading");
      renderTarget(2);
      report = await startExamination();
    }
    renderTarget(100);
    elements.progressMessage.textContent = "Examination complete";
    state.history = saveToHistory(report, url);
    selectReport(report);
    renderHistory();
    setStatus(`Examined ${repoName(report)}. The record is below.`);
    elements.record.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
    elements.launcher.classList.add("is-inviting");
  } catch (error) {
    setStatus(error.message.replace(/^./, (character) => character.toUpperCase()), "error");
    elements.progressWrap.hidden = true;
  } finally {
    elements.submit.disabled = false;
    elements.input.removeAttribute("aria-busy");
  }
}

// --- Inspection slip ----------------------------------------------------------

function openDetail(checkId) {
  const index = state.report.checks.findIndex((check) => check.id === checkId);
  const check = state.report.checks[index];
  if (!check) return;
  state.activeCheckId = check.id;
  $("#checkDetailMeta").textContent = `Line ${String(index + 1).padStart(2, "0")} · ${check.id}`;
  $("#checkDetailOptotype").textContent = check.id[0].toUpperCase();
  $("#checkDetailOptotype").className = `slip-optotype optotype-${check.status}`;
  $("#checkDetailTitle").textContent = check.title;
  $("#checkDetailStatus").innerHTML = statusMark(check.status);
  $("#checkDetailSummary").textContent = check.detail;
  $("#checkDetailEvidenceRow").hidden = !check.locations?.length;
  $("#checkDetailEvidence").innerHTML = evidenceList(check);
  $("#checkDetailMeasures").textContent = CATALOGUE[check.id]?.measures || "";
  $("#checkDetailGuidance").textContent = guidanceFor(check);
  $("#checkDetailVerify").textContent = CATALOGUE[check.id]?.verify || "";
  elements.detail.showModal();
  renderExaminer();
}

// --- The examiner ---------------------------------------------------------------

// Offline mode: deterministic answers from the report alone, in the same shape as Gemini's.
function offlineAnswer(question) {
  const report = state.report;
  const text = question.toLowerCase();
  const focus = activeCheck();
  const actionable = prioritizedChecks(report);
  const plan = () => actionable.map((check) => ({ title: check.title, detail: guidanceFor(check), verify: CATALOGUE[check.id]?.verify || "" }));
  if (/(plan|steps|roadmap|review|fix plan)/.test(text)) {
    return {
      answer: actionable.length ? `**${repoName(report)}** reads ${acuity(report.score).snellen} with ${actionable.length} line${actionable.length === 1 ? "" : "s"} to correct. Work through them in this order; exposed credentials always come first.` : `**${repoName(report)}** reads 20/20. There is nothing to correct; keep documentation, tests and CI current.`,
      recommendations: [], workflow: plan(), follow_ups: actionable.length ? [`How do I resolve the ${actionable[0].id} finding?`] : [],
    };
  }
  if (focus && /(this|check|line|explain|resolve|fix)/.test(text)) {
    return {
      answer: `\`${focus.id}\` is **${STATUS[focus.status].label.toLowerCase()}**: ${focus.detail}.\n\n${CATALOGUE[focus.id].measures}\n\n${guidanceFor(focus)}\n\nVerify with:\n\n\`\`\`\n${CATALOGUE[focus.id].verify}\n\`\`\``,
      recommendations: [], workflow: [], follow_ups: ["Build a fix plan for the whole report"],
    };
  }
  if (/(first|priority|urgent|next|most important)/.test(text)) {
    const first = actionable[0];
    return {
      answer: first ? `Start with \`${first.id}\`, **${first.title.toLowerCase()}**: ${first.detail}. ${guidanceFor(first)}` : "Nothing is urgent. Every line reads clearly.",
      recommendations: [], workflow: [], follow_ups: first ? [`How do I verify the ${first.id} fix?`, "Build a fix plan for the whole report"] : [],
    };
  }
  const tally = counts(report);
  return {
    answer: `Offline mode answers from the report only. **${repoName(report)}** scores ${report.score}/100 (${acuity(report.score).snellen}): ${tally.pass} clear, ${tally.warn} advisory, ${tally.fail} blocking. Ask for a plan, what to fix first, or open a line and ask about it. Switch to Gemini for free-form questions.`,
    recommendations: [], workflow: [], follow_ups: ["What should I fix first?", "Build a fix plan"],
  };
}

// Earlier answers are replayed as plain text with numbered steps, so follow-ups like "explain step two" resolve.
function messageAsText({ text, insights }) {
  if (!insights) return text;
  const recommendations = insights.recommendations.map((item) => `- ${item.text}`);
  const steps = insights.workflow.map((step, index) => `Step ${index + 1}: ${step.title} - ${step.detail}`);
  return [insights.answer, recommendations.length ? `Recommendations:\n${recommendations.join("\n")}` : "", steps.join("\n")].filter(Boolean).join("\n\n");
}

function answerMarkup(insights) {
  const recommendations = insights.recommendations.length ? `<div class="answer-block"><p class="label">Recommendations</p><ul class="answer-recs">${insights.recommendations.map((item) => `<li>${renderMarkdown(item.text).replace(/^<p>|<\/p>$/g, "")}${item.checks.map((id) => ` <code class="tag">${escapeHtml(id)}</code>`).join("")}</li>`).join("")}</ul></div>` : "";
  const workflow = insights.workflow.length ? `<div class="answer-block"><p class="label">Prescribed steps</p><ol class="answer-steps">${insights.workflow.map((step, index) => `<li><span class="step-no">${String(index + 1).padStart(2, "0")}</span><div><strong>${escapeHtml(step.title)}</strong><div class="step-detail">${renderMarkdown(step.detail)}</div>${step.verify ? `<p class="step-verify"><span>Verify</span>${renderMarkdown(step.verify).replace(/^<p>|<\/p>$/g, "")}</p>` : ""}</div></li>`).join("")}</ol></div>` : "";
  const followUps = insights.follow_ups.length ? `<div class="follow-ups">${insights.follow_ups.map((question) => `<button type="button" class="prompt" data-question="${escapeHtml(question)}">${escapeHtml(question)}</button>`).join("")}</div>` : "";
  return `<div class="answer">${renderMarkdown(insights.answer)}</div>${recommendations}${workflow}${followUps}`;
}

function renderTranscript() {
  if (!state.report) {
    elements.chat.innerHTML = '<div class="entry entry-note"><p>Examine a repository first. The examiner reads the record it produces.</p></div>';
    return;
  }
  const opening = `<div class="entry entry-note"><p>Record loaded for <strong>${escapeHtml(repoName(state.report))}</strong>, reading ${acuity(state.report.score).snellen}. Ask for a review, or open a line of the chart and ask about it.</p></div>`;
  elements.chat.innerHTML = opening + state.conversation.map((message) => {
    if (message.role === "user") {
      return `<div class="entry entry-q"><p class="entry-label"><span>Q.</span> ${escapeHtml(message.time)}${message.focus ? ` · on <code>${escapeHtml(message.focus)}</code>` : ""}</p><p class="entry-question">${escapeHtml(message.text)}</p></div>`;
    }
    const body = message.pending ? `<p class="entry-pending"><span class="pending-bars" aria-hidden="true"><i></i><i></i><i></i></span>${escapeHtml(message.text)}</p>` : message.error ? `<p class="entry-error">${escapeHtml(message.text)}</p>` : answerMarkup(message.insights);
    return `<div class="entry entry-a${message.error ? " is-error" : ""}"><p class="entry-label"><span>A.</span> ${escapeHtml(message.source || "Examiner")}</p>${body}</div>`;
  }).join("");
  elements.chat.scrollTop = elements.chat.scrollHeight;
}

function renderExaminer() {
  const focus = activeCheck();
  elements.focus.hidden = !focus;
  if (focus) elements.focusLabel.textContent = `${focus.title} (${focus.id})`;
  renderTranscript();
}

function setExaminerBusy(busy) {
  elements.send.disabled = busy;
  elements.input2.disabled = busy;
  document.querySelectorAll(".examiner .prompt, input[name=advisorMode]").forEach((control) => { control.disabled = busy; });
  elements.cancel.hidden = !busy;
  if (busy) elements.retry.hidden = true;
  elements.chat.setAttribute("aria-busy", String(busy));
}

async function refreshAiStatus() {
  try {
    const response = await fetch("/api/ai/status", { signal: AbortSignal.timeout(5000) });
    if (!response.ok) throw new Error("Server unavailable");
    const config = await response.json();
    state.aiTimeout = config.timeout_seconds || 120;
    state.aiReady = Boolean(config.configured);
    elements.connection.textContent = config.configured ? "Gemini ready" : "No API key on server";
    elements.connection.title = config.message;
  } catch {
    state.aiReady = false;
    elements.connection.textContent = "Server unavailable";
  }
  elements.connection.dataset.ready = String(state.aiReady);
  if (!state.aiReady && mode() === "gemini") document.querySelector("input[name=advisorMode][value=local]").checked = true;
}

function clock() {
  return new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

async function askGemini(question) {
  const report = state.report;
  const history = state.conversation.filter((message) => !message.error && !message.pending).slice(-8).map((message) => ({ role: message.role, text: messageAsText(message).slice(0, 8000) }));
  state.lastQuestion = question;
  state.conversation.push({ role: "user", text: question, time: clock(), focus: state.activeCheckId });
  const pending = { role: "bot", source: "Gemini", text: "Reading the record…", pending: true };
  state.conversation.push(pending);
  renderTranscript();
  const controller = new AbortController();
  state.controller = controller;
  const timeout = setTimeout(() => controller.abort("timeout"), (state.aiTimeout + 10) * 1000);
  setExaminerBusy(true);
  try {
    const startResponse = await fetch("/api/insights", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ report, question, history, focus: state.activeCheckId }),
      signal: controller.signal,
    });
    const start = await startResponse.json();
    if (!startResponse.ok) throw new Error(start.error || "Could not reach the examiner");
    const deadline = Date.now() + (state.aiTimeout + 5) * 1000;
    let insights = null;
    while (Date.now() < deadline) {
      const statusResponse = await fetch(`/api/insights/${start.job_id}?ts=${Date.now()}`, { signal: controller.signal });
      const job = await statusResponse.json();
      if (statusResponse.status === 404) throw new Error("The server restarted before answering. Press Retry to ask again.");
      if (!statusResponse.ok) throw new Error(job.error || "The examiner's job is unavailable");
      if (job.state === "complete") { insights = job.insights; break; }
      if (job.state === "error") throw new Error(job.error || job.message || "The examiner could not answer");
      pending.text = job.message;
      renderTranscript();
      await new Promise((resolve) => setTimeout(resolve, 700));
    }
    if (!insights) throw new Error("The examiner timed out");
    if (state.report !== report || controller.signal.aborted) return;
    Object.assign(pending, { pending: false, text: insights.answer, source: `Gemini · ${insights.model}`, insights });
    if (insights.workflow.length) {
      state.insights = insights;
      elements.exportPlan.disabled = false;
    }
  } catch (error) {
    Object.assign(pending, { pending: false, error: true, text: controller.signal.aborted ? (controller.signal.reason === "timeout" ? "The examiner timed out. Retry when ready." : "Cancelled. A request already sent may still finish on the server.") : error.message });
  } finally {
    clearTimeout(timeout);
    state.controller = null;
    setExaminerBusy(false);
    elements.retry.hidden = !pending.error || state.report !== report;
    if (state.report === report) renderTranscript();
  }
}

function askExaminer(question) {
  question = question.trim();
  if (!question || state.controller) return;
  if (!state.report) {
    renderTranscript();
    return;
  }
  if (mode() === "local") {
    const insights = offlineAnswer(question);
    state.conversation.push({ role: "user", text: question, time: clock(), focus: state.activeCheckId });
    state.conversation.push({ role: "bot", source: "Offline examiner", text: insights.answer, insights });
    if (insights.workflow.length) {
      state.insights = insights;
      elements.exportPlan.disabled = false;
    }
    renderTranscript();
    return;
  }
  askGemini(question);
}

function openExaminer(prefill = "") {
  if (elements.detail.open) elements.detail.close();
  elements.launcher.classList.remove("is-inviting");
  renderExaminer();
  if (!elements.panel.open) elements.panel.showModal();
  refreshAiStatus();
  if (prefill) elements.input2.value = prefill;
  elements.input2.focus();
}

function exportPlan() {
  if (!state.insights || !state.report) return;
  const { answer, recommendations, workflow } = state.insights;
  const text = [`# Prescription: ${state.report.root}`, "", answer, "",
    ...(recommendations.length ? ["## Recommendations", ...recommendations.map((item) => `- ${item.text}`), ""] : []),
    "## Steps", ...workflow.map((step) => `- [ ] **${step.title}**\n  ${step.detail}${step.verify ? `\n  - Verify: ${step.verify}` : ""}`), "",
    "_Generated guidance. Review before applying changes._"].join("\n");
  download("repolens-prescription.md", text);
  toast("Plan saved as Markdown");
}

// --- Wiring ---------------------------------------------------------------------

elements.form.addEventListener("submit", analyzeRepository);
document.querySelectorAll("[data-sample]").forEach((button) => button.addEventListener("click", () => {
  elements.input.value = button.dataset.sample;
  elements.form.requestSubmit();
}));

document.querySelectorAll(".filter").forEach((button) => button.addEventListener("click", () => {
  document.querySelectorAll(".filter").forEach((item) => {
    item.classList.toggle("is-active", item === button);
    item.setAttribute("aria-pressed", String(item === button));
  });
  state.filter = button.dataset.filter;
  if (state.report) renderLines();
}));

elements.grid.addEventListener("click", (event) => {
  const button = event.target.closest("[data-check-id]");
  if (button) openDetail(button.dataset.checkId);
});

elements.historyList.addEventListener("click", (event) => {
  const button = event.target.closest("[data-entry]");
  const entry = button && state.history.find((item) => item.id === button.dataset.entry);
  if (!entry) return;
  selectReport(entry.report, entry.scannedAt);
  elements.input.value = entry.url;
  setStatus(`Showing the saved examination of ${repoName(entry.report)}.`);
  elements.record.scrollIntoView({ block: "start" });
});

$("#clearHistory").addEventListener("click", () => {
  storeHistory([]);
  state.history = [];
  renderHistory();
  toast("Case files cleared");
});

$("#rxMarkdown").addEventListener("click", () => state.report && exportMarkdown(state.report));
$("#rxPrint").addEventListener("click", () => state.report && exportPdf(state.report, state.scannedAt));
$("#askPlan").addEventListener("click", () => {
  state.activeCheckId = null;
  openExaminer();
  askExaminer(DEFAULT_QUESTION);
});

$("#closeCheckDetail").addEventListener("click", () => elements.detail.close());
elements.detail.addEventListener("click", (event) => { if (event.target === elements.detail) elements.detail.close(); });
$("#askAboutCheck").addEventListener("click", () => openExaminer(`How do I resolve the ${state.activeCheckId} finding?`));

elements.launcher.addEventListener("click", () => openExaminer());
$("#assistantToggle").addEventListener("click", () => elements.panel.close());
elements.panel.addEventListener("click", (event) => { if (event.target === elements.panel) elements.panel.close(); });
elements.panel.addEventListener("close", () => elements.launcher.focus());
$("#clearFocus").addEventListener("click", () => { state.activeCheckId = null; renderExaminer(); });

document.querySelectorAll(".examiner .prompts .prompt").forEach((button) => button.addEventListener("click", () => askExaminer(button.dataset.question)));
elements.chat.addEventListener("click", (event) => {
  const button = event.target.closest("[data-question]");
  if (button) askExaminer(button.dataset.question);
});

$("#assistantForm").addEventListener("submit", (event) => {
  event.preventDefault();
  const question = elements.input2.value;
  elements.input2.value = "";
  askExaminer(question);
});
elements.input2.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    $("#assistantForm").requestSubmit();
  }
});

elements.cancel.addEventListener("click", () => state.controller?.abort());
elements.retry.addEventListener("click", () => {
  // Drop the failed exchange so the retried question is the only copy sent.
  const failed = state.conversation.findLastIndex((message) => message.error);
  if (failed > 0) state.conversation.splice(failed - 1, 2);
  askExaminer(state.lastQuestion);
});
elements.exportPlan.addEventListener("click", exportPlan);
document.querySelectorAll("input[name=advisorMode]").forEach((radio) => radio.addEventListener("change", () => {
  if (radio.value === "gemini" && !state.aiReady) toast("The server has no Gemini key; offline answers only", "error");
}));

renderMethod();
renderHistory();
render();
refreshAiStatus();
