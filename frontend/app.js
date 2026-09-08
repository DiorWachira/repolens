const HISTORY_KEY = "repolens-session-history";
const state = { report: null, filter: "all", history: loadHistory() };

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
  actionCount: document.querySelector("#actionCount"),
  actionsList: document.querySelector("#actionsList"),
  historyCount: document.querySelector("#historyCount"),
  historyList: document.querySelector("#historyList"),
  clearHistory: document.querySelector("#clearHistory"),
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
  elements.historyCount.textContent = state.history.length;
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
    lines.push(`### ${check.status.toUpperCase()} - ${check.title}`, "", `- ID: \`${check.id}\``, `- Detail: ${check.detail}`, `- Guidance: ${FIX_GUIDANCE[check.id][check.status]}`, "");
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
  lines.push(`### ${check.status.toUpperCase()} - ${check.title}`, "", `- ID: \`${check.id}\``, `- Detail: ${check.detail}`, ...(check.locations || []).map((location) => `- Location: ${location}`), `- Guidance: ${FIX_GUIDANCE[check.id][check.status]}`, "");

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
    <article class="check-card" style="animation-delay: ${index * 55}ms">
      <div class="check-top"><span class="status-dot ${check.status}"></span><span class="status-label ${check.status}">${statusLabel(check.status)}</span></div>
      <div><h3>${check.title}</h3><p class="check-detail">${check.detail}</p><p class="check-detail"><strong>${check.status === "pass" ? "Next:" : "Fix:"}</strong> ${FIX_GUIDANCE[check.id][check.status]}</p></div>
        <div><h3>${check.title}</h3><p class="check-detail">${escapeHtml(check.detail)}</p>${evidenceMarkup(check)}<p class="check-detail"><strong>${check.status === "pass" ? "Next:" : "Fix:"}</strong> ${FIX_GUIDANCE[check.id][check.status]}</p></div>
      <span class="check-id">${check.id}</span>
    </article>
  `).join("");

  const actions = report.checks.filter((check) => check.status !== "pass");
  elements.actionCount.textContent = actions.length ? `${actions.length} item${actions.length === 1 ? "" : "s"}` : "clear";
  elements.actionsList.innerHTML = actions.length ? actions.map((check) => `
    <article class="action-item">
      <span class="status-dot ${check.status}"></span>
      <strong class="action-title">${check.title}</strong>
      <p class="action-copy"><strong>${check.detail}</strong><br>${FIX_GUIDANCE[check.id][check.status]}</p>
      <p class="action-copy"><strong>${escapeHtml(check.detail)}</strong><br>${FIX_GUIDANCE[check.id][check.status]}${evidenceMarkup(check)}</p>
    </article>
  `).join("") : '<p class="all-clear">All checks are passing. There is nothing urgent to fix.</p>';
}

async function loadReport() {
  elements.grid.innerHTML = '<p class="check-detail">Loading latest report...</p>';
  try {
    const response = await fetch(`report.json?ts=${Date.now()}`);
    if (!response.ok) throw new Error("Report unavailable");
    state.report = await response.json();
    render();
  } catch (error) {
    elements.grid.innerHTML = `<p class="check-detail">${error.message}. Run the audit and place its JSON output at frontend/report.json.</p>`;
  }
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
    saveHistory(payload, url);
    elements.source.textContent = "source repository";
    elements.updated.textContent = payload.root;
    elements.formStatus.className = "form-status";
    elements.formStatus.textContent = "Analysis complete. Results below are from the public repository.";
    elements.progressMessage.textContent = "Analysis complete";
    elements.progress.value = 100;
    elements.progressPercent.textContent = "100%";
    render();
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
document.querySelector("#refreshButton").addEventListener("click", loadReport);
elements.form.addEventListener("submit", analyzeRepository);
loadReport();