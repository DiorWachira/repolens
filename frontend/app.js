const HISTORY_KEY = "repolens-session-history";
const state = { report: null, filter: "all", history: loadHistory(), activeCheckId: null, assistantOpen: false };
state.assistantConversation = [];

const elements = {
  score: document.querySelector("#scoreValue"),
  scoreRing: document.querySelector("#scoreRing"),
  scoreNote: document.querySelector("#scoreNote"),
  pass: document.querySelector("#passCount"),
  warn: document.querySelector("#warnCount"),
  fail: document.querySelector("#failCount"),
  updated: document.querySelector("#updatedAt"),
  source: document.querySelector("#sourceLabel"),
  form: document.querySelector("#repoForm"),
  input: document.querySelector("#repoUrl"),
  formStatus: document.querySelector("#formStatus"),
  progressWrap: document.querySelector("#progressWrap"),
  progress: document.querySelector("#analysisProgress"),
  progressMessage: document.querySelector("#progressMessage"),
  progressPercent: document.querySelector("#progressPercent"),
  grid: document.querySelector("#checksGrid"),
  detailOverlay: document.querySelector("#checkDetailOverlay"),
  detailTitle: document.querySelector("#checkDetailTitle"),
  detailStatus: document.querySelector("#checkDetailStatus"),
  detailDot: document.querySelector("#checkDetailDot"),
  detailSummary: document.querySelector("#checkDetailSummary"),
  detailGuidance: document.querySelector("#checkDetailGuidance"),
  detailMeta: document.querySelector("#checkDetailMeta"),
  detailEvidence: document.querySelector("#checkDetailEvidence"),
  closeDetail: document.querySelector("#closeCheckDetail"),
  actionCount: document.querySelector("#actionCount"),
  actionsList: document.querySelector("#actionsList"),
  historyCount: document.querySelector("#historyCount"),
  historyList: document.querySelector("#historyList"),
  clearHistory: document.querySelector("#clearHistory"),
  assistantPanel: document.querySelector("#assistantPanel"),
  assistantBackdrop: document.querySelector("#assistantBackdrop"),
  assistantToggle: document.querySelector("#assistantToggle"),
  assistantLauncher: document.querySelector("#assistantLauncher"),
  assistantSuggestion: document.querySelector("#assistantSuggestion"),
  assistantFocusLabel: document.querySelector("#assistantFocusLabel"),
  assistantBadge: document.querySelector("#assistantBadge"),
  assistantPrompts: document.querySelectorAll(".assistant-prompt"),
  assistantChat: document.querySelector("#assistantChat"),
  assistantTaskList: document.querySelector("#assistantTaskList"),
  assistantInsight: document.querySelector("#assistantInsight"),
  assistantInput: document.querySelector("#assistantInput"),
  assistantSend: document.querySelector("#assistantSend"),
  assistantSuggestions: document.querySelectorAll(".assistant-suggestion"),
};

function loadHistory() {
  try {
    return JSON.parse(sessionStorage.getItem(HISTORY_KEY) || "[]");
  } catch {
    return [];
  }
}

function saveHistory(report, url) {
  const entry = { id: `${Date.now()}`, url, report, scannedAt: new Date().toISOString() };
  state.history = [entry, ...state.history.filter((item) => item.url !== url)].slice(0, 12);
  sessionStorage.setItem(HISTORY_KEY, JSON.stringify(state.history));
}

function renderHistory() {
  if (elements.historyCount) {
    elements.historyCount.textContent = String(state.history.length);
  }
  if (!elements.historyList) return;
  if (!state.history.length) {
    elements.historyList.innerHTML = '<p class="history-empty">No scans saved in this browser session yet.</p>';
    return;
  }
  elements.historyList.innerHTML = "";
  state.history.forEach((entry) => {
    const item = document.createElement("article");
    item.className = "history-item";
    const repo = document.createElement("div");
    repo.className = "history-repo";
    const title = document.createElement("strong");
    title.textContent = entry.report.root.replace("github.com/", "");
    const date = document.createElement("span");
    date.textContent = new Date(entry.scannedAt).toLocaleString([], { dateStyle: "short", timeStyle: "short" });
    repo.append(title, date);
    const score = document.createElement("span");
    score.className = "history-score";
    score.textContent = `${entry.report.score}`;
    const open = document.createElement("button");
    open.className = "history-open";
    open.type = "button";
    open.title = "Open this report";
    open.textContent = "->";
    open.addEventListener("click", () => {
      state.report = entry.report;
      elements.source.textContent = "source repository";
      elements.updated.textContent = entry.report.root.replace("github.com/", "");
      elements.formStatus.className = "form-status";
      elements.formStatus.textContent = "Showing a saved scan from this session.";
      render();
      document.querySelector("#actionsHeading").scrollIntoView({ behavior: "smooth" });
    });
    const actions = document.createElement("div");
    actions.className = "history-actions";
    const markdown = document.createElement("button");
    markdown.className = "history-export";
    markdown.type = "button";
    markdown.textContent = "MD";
    markdown.title = "Download Markdown report";
    markdown.addEventListener("click", () => exportMarkdown(entry.report));
    const pdf = document.createElement("button");
    pdf.className = "history-export";
    pdf.type = "button";
    pdf.textContent = "PDF";
    pdf.title = "Print or save as PDF";
    pdf.addEventListener("click", () => exportPdf(entry.report));
    actions.append(markdown, pdf, open);
    item.append(repo, score, actions);
    elements.historyList.append(item);
  });
}

const FIX_GUIDANCE = {
  readme: {
    pass: "Keep the root README current as the project changes.",
    warn: "Expand the root README to at least 300 characters with setup, usage, and development details.",
    fail: "Add a README.md, README.rst, or README.txt at the repository root with setup and usage instructions.",
  },
  license: { pass: "No action needed.", warn: "Add a LICENSE or COPYING file. Choose a license, save its official text at the repository root, and mention it in the README." },
  gitignore: { pass: "No action needed.", warn: "Add a .gitignore covering generated files, environments, caches, and local secrets. Remove already-tracked artifacts with git rm --cached." },
  tests: { pass: "No action needed.", fail: "Add automated tests in a tests directory or recognized test files. Run them in CI so regressions block merges." },
  ci: { pass: "No action needed.", warn: "Add a workflow under .github/workflows that installs dependencies, runs tests, and reports failures on pull requests." },
  todos: { pass: "No action needed.", warn: "Review each TODO, FIXME, HACK, and XXX. Fix completed work, convert real follow-ups into tracked issues, and keep the marker count at 10 or fewer." },
  "large-files": { pass: "No action needed.", warn: "Remove large generated/media files from git history or move them to release storage or Git LFS. Add an ignore rule, then verify with git ls-files." },
  secrets: { pass: "No action needed.", fail: "For every listed location: remove the literal, rotate/revoke the exposed credential, replace it with an environment variable or secret manager reference, then scan git history." },
};

function reportMarkdown(report) {
  const lines = [`# repolens report: ${report.root}`, "", `**Health:** ${report.score}/100`, "", "## Checks", ""];
  report.checks.forEach((check) => {
    lines.push(`### ${check.status.toUpperCase()} - ${check.title}`, "", `- ID: \`${check.id}\``, `- Detail: ${check.detail}`, ...(check.locations || []).map((location) => `- Location: ${location}`), `- Guidance: ${FIX_GUIDANCE[check.id][check.status]}`, "");
  });
  lines.push("## What to fix next", "");
  const actions = report.checks.filter((check) => check.status !== "pass");
  if (!actions.length) lines.push("All checks are passing. There is nothing urgent to fix.");
  actions.forEach((check) => lines.push(`- **${check.title}:** ${check.detail}\n  ${FIX_GUIDANCE[check.id][check.status]}`));
  return lines.join("\n");
}

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", "\"": "&quot;",
  }[character]));
}

function evidenceMarkup(check) {
  if (!check.locations || !check.locations.length) return "";
  return `<details class="evidence"><summary>Show ${check.locations.length} affected location${check.locations.length === 1 ? "" : "s"}</summary><ul>${check.locations.map((location) => `<li><code>${escapeHtml(location)}</code></li>`).join("")}</ul></details>`;
}

function exportMarkdown(report) {
  const name = report.root.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "") || "repolens-report";
  const blob = new Blob([reportMarkdown(report)], { type: "text/markdown;charset=utf-8" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `${name}-report.md`;
  link.click();
  URL.revokeObjectURL(link.href);
}

function exportPdf(report) {
  const printWindow = window.open("", "_blank");
  if (!printWindow) return;
  const checks = report.checks.map((check) => `<li><strong>${escapeHtml(check.status.toUpperCase())} - ${escapeHtml(check.title)}</strong><br>${escapeHtml(check.detail)}${check.locations?.length ? `<ul>${check.locations.map((location) => `<li><code>${escapeHtml(location)}</code></li>`).join("")}</ul>` : ""}<br><em>${escapeHtml(FIX_GUIDANCE[check.id][check.status])}</em></li>`).join("");
  printWindow.document.write(`<title>repolens report - ${escapeHtml(report.root)}</title><style>body{font:14px Arial;max-width:800px;margin:40px auto;color:#16201d}h1{font-size:28px}h2{border-bottom:1px solid #ccc;padding-bottom:8px}li{margin:12px 0;line-height:1.5}</style><h1>repolens report</h1><p><strong>Repository:</strong> ${escapeHtml(report.root)}<br><strong>Health:</strong> ${escapeHtml(report.score)}/100</p><h2>Checks</h2><ul>${checks}</ul>`);
  printWindow.document.close();
  printWindow.focus();
  printWindow.print();
}

function statusLabel(status) {
  return status === "pass" ? "healthy" : status === "warn" ? "advisory" : "blocking";
}

function renderDetailWindow(check) {
  if (!check) {
    elements.detailOverlay.hidden = true;
    state.activeCheckId = null;
    return;
  }

  elements.detailOverlay.hidden = false;
  elements.detailTitle.textContent = check.title;
  elements.detailStatus.textContent = statusLabel(check.status);
  elements.detailStatus.className = `status-label ${check.status}`;
  elements.detailDot.className = `status-dot ${check.status}`;
  elements.detailSummary.textContent = check.detail;
  elements.detailGuidance.textContent = `${check.status === "pass" ? "Next:" : "Fix:"} ${FIX_GUIDANCE[check.id][check.status]}`;
  elements.detailMeta.textContent = `Signal ID: ${check.id}`;

  if (check.locations && check.locations.length) {
    elements.detailEvidence.innerHTML = `
      <div class="detail-evidence-wrap">
        <strong>Evidence</strong>
        <ul>${check.locations.map((location) => `<li>${escapeHtml(location)}</li>`).join("")}</ul>
      </div>
    `;
  } else {
    elements.detailEvidence.innerHTML = '<p class="detail-empty">No issue-specific locations were reported for this check.</p>';
  }
}

function explainCheck(check) {
  const focus = check ? `${check.title} (${check.status})` : "overall repository health";
  const advisory = check ? `${FIX_GUIDANCE[check.id][check.status]}` : "The report is currently healthy overall, but the assistant is tuned to highlight the next risk and explain which checks matter most.";
  return `This repo is focused on ${focus}. The signal says: ${check ? check.detail : "the report is broadly healthy"}. The repo-only guidance is to ${advisory}`;
}

function prioritizeCheck(report) {
  const warnings = report.checks.filter((check) => check.status !== "pass");
  if (!warnings.length) {
    return "The repo looks healthy overall. Prioritize maintenance work: keep docs fresh, review TODOs periodically, and maintain CI coverage as the project grows.";
  }
  const first = warnings[0];
  return `The highest-priority issue is ${first.title}. It is currently marked as ${first.status}, with the summary: ${first.detail}. The recommended next move is to address the root cause first, then verify the rest of the repo remains stable.`;
}

function buildPlan(report) {
  const actionable = report.checks.filter((check) => check.status !== "pass");
  if (!actionable.length) {
    return "The repo is in a strong place. Keep the plan simple: maintain docs, preserve CI, and monitor TODO churn as the codebase evolves.";
  }
  return actionable.slice(0, 3).map((check) => `- ${check.title}: ${FIX_GUIDANCE[check.id][check.status]}`).join(" ");
}

function assistantResponse(prompt) {
  if (!state.report) {
    return "Start with a repository scan to get repo-focused guidance.";
  }

  const report = state.report;
  const active = report.checks.find((item) => item.id === state.activeCheckId) || null;

  switch (prompt) {
    case "overview":
      return `Overall health is ${report.score}/100. ${report.checks.filter((item) => item.status === "pass").length} checks are clear, ${report.checks.filter((item) => item.status === "warn").length} are advisory, and ${report.checks.filter((item) => item.status === "fail").length} need action. This is a repo-only summary that stays within the current health evidence.`;
    case "priority":
      return prioritizeCheck(report);
    case "check":
      return explainCheck(active);
    case "plan":
      return buildPlan(report);
    default:
      return "The repo advisor is scoped to repository health, not general-purpose chat.";
  }
}

function resolveAssistantReply(rawText) {
  const text = String(rawText || "").trim().toLowerCase();
  if (!text) return "Ask about repo health, the most important fix, or explain a specific check.";
  if (!state.report) return "Start with a repository scan to get repo-focused guidance.";

  if (/(health|overview|summary|status)/.test(text)) return assistantResponse("overview");
  if (/(first|priority|urgent|next|most important)/.test(text)) return assistantResponse("priority");
  if (/(plan|fix|roadmap|next steps|what should i do)/.test(text)) return assistantResponse("plan");
  if (/(check|why|explain|detail)/.test(text)) return assistantResponse("check");

  const active = state.report.checks.find((item) => item.id === state.activeCheckId) || null;
  if (active) return explainCheck(active);
  return `I can help reason about ${state.report.root}. The repo-only scope is to explain health signals, prioritize fixes, and suggest the next evidence-backed step.`;
}

function buildAssistantTasks(report) {
  if (!report) return [];
  const actionable = report.checks.filter((check) => check.status !== "pass");
  if (!actionable.length) {
    return [
      { label: "Maintain the current health baseline", detail: "Keep CI, docs, and test coverage in sync." },
      { label: "Review TODO drift", detail: "Mitigate growing maintenance debt before it becomes risk." },
    ];
  }

  return actionable.slice(0, 4).map((check) => ({
    label: check.title,
    detail: FIX_GUIDANCE[check.id]?.[check.status] || check.detail,
  }));
}

function renderAssistantChat() {
  if (!elements.assistantChat) return;
  const conversation = state.assistantConversation.length ? state.assistantConversation : [{ role: "bot", text: "Repository analysis is ready. Select a check or ask for a repo-focused recommendation." }];
  elements.assistantChat.innerHTML = conversation.map((message) => `
    <div class="assistant-message assistant-message-${message.role}">
      <p class="assistant-message-label">${message.role === "bot" ? "Advisor" : "You"}</p>
      <p>${escapeHtml(message.text)}</p>
    </div>
  `).join("");
  elements.assistantChat.scrollTop = elements.assistantChat.scrollHeight;
}

function renderAssistantInsight(report) {
  if (!elements.assistantInsight) return;
  if (!report) {
    elements.assistantInsight.innerHTML = '<p class="assistant-insight-empty">No repository loaded.</p>';
    return;
  }

  const active = report.checks.find((item) => item.id === state.activeCheckId) || null;
  const summary = active
    ? `${active.title}: ${active.detail}`
    : `Overall health score: ${report.score}/100`;

  const focus = active ? active.status : (report.score >= 80 ? "pass" : report.score >= 60 ? "warn" : "fail");
  const focusText = focus === "pass" ? "Healthy" : focus === "warn" ? "Watch" : focus === "fail" ? "Needs attention" : "Healthy";

  elements.assistantInsight.innerHTML = `
    <div class="assistant-insight-card ${focus}">
      <span class="assistant-insight-kicker">Focus</span>
      <strong>${escapeHtml(focusText)}</strong>
    </div>
    <p>${escapeHtml(summary)}</p>
    <ul>
      <li>${report.checks.filter((check) => check.status === "pass").length} passing checks</li>
      <li>${report.checks.filter((check) => check.status === "warn").length} warnings</li>
      <li>${report.checks.filter((check) => check.status === "fail").length} blockers</li>
    </ul>
  `;
}

function renderAssistantTasks(report) {
  if (!elements.assistantTaskList) return;
  const tasks = buildAssistantTasks(report);
  elements.assistantTaskList.innerHTML = tasks.map((task) => `
    <li class="assistant-task-item">
      <strong>${escapeHtml(task.label)}</strong>
      <span>${escapeHtml(task.detail)}</span>
    </li>
  `).join("");
}

function addAssistantMessage(role, text) {
  const normalized = String(text || "").trim();
  if (!normalized) return;
  state.assistantConversation.push({ role, text: normalized });
  state.assistantConversation = state.assistantConversation.slice(-8);
  renderAssistantChat();
}

function renderAssistant() {
  const report = state.report;
  if (!report) {
    elements.assistantBadge.textContent = "idle";
    elements.assistantFocusLabel.textContent = "No repo loaded";
    renderAssistantTasks(null);
    renderAssistantInsight(null);
    if (!state.assistantConversation.length) {
      state.assistantConversation = [{ role: "bot", text: "Start with a repository scan to get repo-focused guidance." }];
    }
    renderAssistantChat();
    return;
  }

  const active = report.checks.find((item) => item.id === state.activeCheckId) || null;
  const badge = active ? (active.status === "pass" ? "healthy" : active.status === "warn" ? "advisory" : "blocking") : (report.score >= 80 ? "healthy" : report.score >= 60 ? "watch" : "needs work");
  elements.assistantBadge.textContent = badge;
  elements.assistantFocusLabel.textContent = active ? active.title : "Overall health";
  const prompt = document.querySelector(".assistant-prompt.is-selected")?.dataset.prompt || "overview";
  if (!state.assistantConversation.length) {
    state.assistantConversation = [{ role: "bot", text: assistantResponse(prompt) }];
  }
  renderAssistantTasks(report);
  renderAssistantInsight(report);
  renderAssistantChat();
}

function renderEmptyState(message = "Paste a public GitHub URL above to run your first repository analysis.") {
  elements.score.textContent = "--";
  elements.scoreNote.textContent = "Waiting for a repository";
  elements.pass.textContent = "--";
  elements.warn.textContent = "--";
  elements.fail.textContent = "--";
  elements.updated.textContent = "--";
  elements.source.textContent = "last scanned";
  elements.scoreRing.style.background = "none";
  elements.grid.innerHTML = `<p class="check-detail empty-dashboard-state">${escapeHtml(message)}</p>`;
  elements.actionCount.textContent = "--";
  elements.actionsList.innerHTML = '<p class="all-clear empty-dashboard-state">Health actions will appear after the first scan.</p>';
  renderAssistant();
}

function render() {
  const { report } = state;
  const counts = report.checks.reduce((result, check) => {
    result[check.status] += 1;
    return result;
  }, { pass: 0, warn: 0, fail: 0 });

  elements.score.textContent = report.score;
  elements.scoreNote.textContent = `${counts.pass} of ${report.checks.length} signals clear`;
  elements.pass.textContent = counts.pass;
  elements.warn.textContent = counts.warn;
  elements.fail.textContent = counts.fail;
  elements.updated.textContent = report.root === "repolens"
    ? new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : report.root.replace("github.com/", "");
  elements.scoreRing.style.background = `conic-gradient(var(--mint) ${report.score}%, rgba(245,242,233,.13) ${report.score}% 100%)`;

  const checks = report.checks.filter((check) => state.filter === "all" || check.status === state.filter);
  elements.grid.innerHTML = checks.map((check, index) => `
    <article class="check-card" data-check-id="${check.id}" tabindex="0" role="button" aria-label="Open details for ${escapeHtml(check.title)}" style="animation-delay: ${index * 55}ms">
      <div class="check-top"><span class="status-dot ${check.status}"></span><span class="status-label ${check.status}">${statusLabel(check.status)}</span></div>
      <div><h3>${check.title}</h3><p class="check-detail">${escapeHtml(check.detail)}</p></div>
      <div class="check-card-footer">
        <span class="check-id">${check.id}</span>
        <span class="check-open-label">Open details</span>
      </div>
    </article>
  `).join("");

  elements.grid.querySelectorAll(".check-card").forEach((card) => {
    const handleOpen = () => {
      state.activeCheckId = card.dataset.checkId;
      const selected = report.checks.find((check) => check.id === state.activeCheckId);
      renderDetailWindow(selected);
      renderAssistant();
    };
    card.addEventListener("click", handleOpen);
    card.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        handleOpen();
      }
    });
  });

  if (state.activeCheckId) {
    const selected = report.checks.find((check) => check.id === state.activeCheckId);
    renderDetailWindow(selected);
  } else {
    elements.detailOverlay.hidden = true;
  }

  renderAssistant();

  const actions = report.checks.filter((check) => check.status !== "pass");
  elements.actionCount.textContent = actions.length ? `${actions.length} item${actions.length === 1 ? "" : "s"}` : "clear";
  elements.actionsList.innerHTML = actions.length ? actions.map((check) => `
    <article class="action-item">
      <span class="status-dot ${check.status}"></span>
      <strong class="action-title">${check.title}</strong>
      <p class="action-copy"><strong>${escapeHtml(check.detail)}</strong><br>${FIX_GUIDANCE[check.id][check.status]}${evidenceMarkup(check)}</p>
    </article>
  `).join("") : '<p class="all-clear">All checks are passing. There is nothing urgent to fix.</p>';
}

async function loadReport() {
  state.report = null;
  renderEmptyState();
}

async function analyzeRepository(event) {
  event.preventDefault();
  const url = elements.input.value.trim();
  if (!url) return;
  elements.formStatus.className = "form-status loading";
  elements.formStatus.textContent = "The server will update this bar as each phase completes.";
  elements.progressWrap.hidden = false;
  elements.progress.value = 2;
  elements.progressPercent.textContent = "2%";
  elements.progressMessage.textContent = "Starting analysis";
  try {
    const response = await fetch("/api/report", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
    });
    const start = await response.json();
    if (!response.ok) throw new Error(start.error || "Could not start analysis");
    const payload = await pollJob(start.job_id);
    state.report = payload;
    state.activeCheckId = null;
    state.assistantConversation = [];
    saveHistory(payload, url);
    renderHistory();
    elements.source.textContent = "source repository";
    elements.updated.textContent = payload.root;
    elements.formStatus.className = "form-status";
    elements.formStatus.textContent = "Analysis complete. Results below are from the public repository.";
    elements.progressMessage.textContent = "Analysis complete";
    elements.progress.value = 100;
    elements.progressPercent.textContent = "100%";
    render();
    showAssistantSuggestion();
  } catch (error) {
    elements.formStatus.className = "form-status error";
    elements.formStatus.textContent = error.message;
    elements.progressWrap.hidden = true;
  }
}

async function pollJob(jobId) {
  const deadline = Date.now() + 190000;
  while (Date.now() < deadline) {
    const response = await fetch(`/api/report/${jobId}?ts=${Date.now()}`);
    const job = await response.json();
    if (!response.ok) throw new Error(job.error || "Analysis job unavailable");
    elements.progress.value = job.progress;
    elements.progressPercent.textContent = `${job.progress}%`;
    elements.progressMessage.textContent = job.message;
    if (job.state === "complete") return job.report;
    if (job.state === "error") throw new Error(job.error || job.message || "Analysis failed");
    await new Promise((resolve) => setTimeout(resolve, 450));
  }
  throw new Error("Analysis timed out after 190 seconds");
}

document.querySelectorAll(".filter-button").forEach((button) => {
  button.addEventListener("click", () => {
    document.querySelectorAll(".filter-button").forEach((item) => item.classList.remove("is-active"));
    button.classList.add("is-active");
    state.filter = button.dataset.filter;
    if (state.report) render();
  });
});

function showAssistantSuggestion() {
  elements.assistantSuggestion.classList.add("is-visible");
}

function closeAssistant() {
  state.assistantOpen = false;
  elements.assistantPanel.classList.add("is-collapsed");
  elements.assistantPanel.classList.remove("is-fullscreen");
  elements.assistantPanel.setAttribute("aria-hidden", "true");
  elements.assistantBackdrop.hidden = true;
  document.body.classList.remove("assistant-modal-open");
  elements.assistantToggle.textContent = "Hide";
}

function openAssistant() {
  if (!state.report) return;
  state.assistantOpen = true;
  elements.assistantPanel.classList.remove("is-collapsed");
  elements.assistantPanel.setAttribute("aria-hidden", "false");
  elements.assistantBackdrop.hidden = false;
  document.body.classList.add("assistant-modal-open");
  elements.assistantSuggestion.classList.remove("is-visible");
  elements.assistantToggle.textContent = "Close";
  elements.assistantInput.focus();
}

elements.assistantToggle.addEventListener("click", () => {
  state.assistantOpen = !state.assistantOpen;
  if (state.assistantOpen) openAssistant();
  else closeAssistant();
});

elements.assistantPanel.addEventListener("dblclick", () => {
  const next = !elements.assistantPanel.classList.contains("is-fullscreen");
  elements.assistantPanel.classList.toggle("is-fullscreen", next);
});

elements.assistantLauncher.addEventListener("click", () => {
  openAssistant();
});

elements.assistantBackdrop.addEventListener("click", closeAssistant);

elements.assistantPrompts.forEach((button) => {
  button.addEventListener("click", () => {
    elements.assistantPrompts.forEach((item) => item.classList.toggle("is-selected", item === button));
    const selectedPrompt = button.dataset.prompt;
    const response = assistantResponse(selectedPrompt);
    addAssistantMessage("bot", response);
  });
});

elements.assistantSuggestions.forEach((button) => {
  button.addEventListener("click", () => {
    const selectedPrompt = button.dataset.prompt;
    const response = assistantResponse(selectedPrompt);
    addAssistantMessage("user", `Prompt: ${selectedPrompt}`);
    addAssistantMessage("bot", response);
  });
});

elements.assistantSend.addEventListener("click", () => {
  const value = elements.assistantInput.value.trim();
  if (!value) return;
  addAssistantMessage("user", value);
  elements.assistantInput.value = "";
  addAssistantMessage("bot", resolveAssistantReply(value));
});

elements.assistantInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    elements.assistantSend.click();
  }
});

elements.detailOverlay.addEventListener("click", (event) => {
  if (event.target === elements.detailOverlay) {
    renderDetailWindow(null);
  }
});
elements.closeDetail.addEventListener("click", () => renderDetailWindow(null));
if (elements.clearHistory) {
  elements.clearHistory.addEventListener("click", () => {
    state.history = [];
    sessionStorage.removeItem(HISTORY_KEY);
    renderHistory();
  });
}
document.querySelector("#refreshButton").addEventListener("click", loadReport);
elements.form.addEventListener("submit", analyzeRepository);
renderHistory();
loadReport();