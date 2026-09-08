const HISTORY_KEY = "repolens-session-history";
const guidance = {
  readme: { pass: "Keep the root README current.", warn: "Expand the README to at least 300 characters with setup, usage, and development details.", fail: "Add a root README with setup and usage instructions." },
  license: { pass: "No action needed.", warn: "Add a LICENSE or COPYING file, use its official text, and mention the license in the README." },
  gitignore: { pass: "No action needed.", warn: "Ignore generated files, environments, caches, and secrets. Remove already-tracked artifacts with git rm --cached." },
  tests: { pass: "No action needed.", fail: "Add automated tests and run them in CI so regressions block merges." },
  ci: { pass: "No action needed.", warn: "Add a CI workflow that installs dependencies and runs tests on pull requests." },
  todos: { pass: "No action needed.", warn: "Review every TODO, FIXME, HACK, and XXX; fix completed work or track follow-ups as issues." },
  "large-files": { pass: "No action needed.", warn: "Remove large generated/media files from git history or move them to release storage or Git LFS." },
  secrets: { pass: "No action needed.", fail: "Remove each literal, rotate/revoke the credential, replace it with secret storage, and scan git history." },
};

const elements = {
  list: document.querySelector("#historyList"),
  summary: document.querySelector("#historySummary"),
  clear: document.querySelector("#clearHistory"),
  view: document.querySelector("#reportView"),
  title: document.querySelector("#reportTitle"),
  score: document.querySelector("#reportScore"),
  checks: document.querySelector("#reportChecks"),
  markdown: document.querySelector("#markdownButton"),
  pdf: document.querySelector("#pdfButton"),
};

function history() {
  try { return JSON.parse(sessionStorage.getItem(HISTORY_KEY) || "[]"); } catch { return []; }
}

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", "\"": "&quot;" }[character]));
}

function evidence(check) {
  if (!check.locations?.length) return "";
  return `<details class="evidence"><summary>Show ${check.locations.length} affected location${check.locations.length === 1 ? "" : "s"}</summary><ul>${check.locations.map((location) => `<li><code>${escapeHtml(location)}</code></li>`).join("")}</ul></details>`;
}

function markdown(report) {
  const lines = [`# repolens report: ${report.root}`, "", `**Health:** ${report.score}/100`, "", "## Checks", ""];
  report.checks.forEach((check) => lines.push(`### ${check.status.toUpperCase()} - ${check.title}`, "", `- Detail: ${check.detail}`, ...(check.locations || []).map((location) => `- Location: ${location}`), `- Guidance: ${guidance[check.id][check.status]}`, ""));
  return lines.join("\n");
}

function exportMarkdown(report) {
  const name = report.root.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "") || "repolens-report";
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([markdown(report)], { type: "text/markdown;charset=utf-8" }));
  link.download = `${name}-report.md`;
  link.click();
  URL.revokeObjectURL(link.href);
}

function exportPdf(report) {
  const popup = window.open("", "_blank");
  if (!popup) return;
  const checks = report.checks.map((check) => `<li><strong>${escapeHtml(check.status.toUpperCase())} - ${escapeHtml(check.title)}</strong><br>${escapeHtml(check.detail)}${check.locations?.length ? `<ul>${check.locations.map((location) => `<li><code>${escapeHtml(location)}</code></li>`).join("")}</ul>` : ""}<br><em>${escapeHtml(guidance[check.id][check.status])}</em></li>`).join("");
  popup.document.write(`<title>repolens report</title><style>body{font:14px Arial;max-width:800px;margin:40px auto;color:#16201d}h1{font-size:28px}h2{border-bottom:1px solid #ccc;padding-bottom:8px}li{margin:12px 0;line-height:1.5}</style><h1>repolens report</h1><p><strong>Repository:</strong> ${escapeHtml(report.root)}<br><strong>Health:</strong> ${report.score}/100</p><h2>Checks</h2><ul>${checks}</ul>`);
  popup.document.close(); popup.focus(); popup.print();
}

function selectReport(entry) {
  const report = entry.report;
  elements.view.hidden = false;
  elements.title.textContent = report.root.replace("github.com/", "");
  elements.score.textContent = `Health ${report.score}/100`;
  elements.checks.innerHTML = report.checks.map((check) => `<article class="history-report-check"><div class="check-top"><span class="status-dot ${check.status}"></span><span class="status-label ${check.status}">${check.status}</span></div><h3>${escapeHtml(check.title)}</h3><p>${escapeHtml(check.detail)}</p>${evidence(check)}<p><strong>${check.status === "pass" ? "Next:" : "Fix:"}</strong> ${escapeHtml(guidance[check.id][check.status])}</p></article>`).join("");
  elements.markdown.onclick = () => exportMarkdown(report);
  elements.pdf.onclick = () => exportPdf(report);
  history.replaceState(null, "", `history.html?id=${encodeURIComponent(entry.id)}`);
  elements.view.scrollIntoView({ behavior: "smooth" });
}

function renderHistory() {
  const entries = history();
  elements.summary.textContent = `${entries.length} saved scan${entries.length === 1 ? "" : "s"}`;
  elements.list.innerHTML = entries.length ? entries.map((entry) => `<article class="history-page-item"><div><strong>${escapeHtml(entry.report.root.replace("github.com/", ""))}</strong><span>${new Date(entry.scannedAt).toLocaleString([], { dateStyle: "short", timeStyle: "short" })}</span></div><b>${entry.report.score}</b><button class="history-select" data-id="${entry.id}" type="button">Open report</button></article>`).join("") : '<p class="history-empty">No scans saved in this browser session yet. Analyze a GitHub repository from the dashboard first.</p>';
  elements.list.querySelectorAll(".history-select").forEach((button) => button.addEventListener("click", () => {
    const entry = entries.find((item) => item.id === button.dataset.id);
    if (entry) selectReport(entry);
  }));
  const selected = new URLSearchParams(location.search).get("id");
  const entry = entries.find((item) => item.id === selected);
  if (entry) selectReport(entry);
}

elements.clear.addEventListener("click", () => { sessionStorage.removeItem(HISTORY_KEY); elements.view.hidden = true; renderHistory(); });
renderHistory();
