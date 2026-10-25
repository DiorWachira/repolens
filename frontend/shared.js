// Shared by the dashboard and the case-file pages: the check catalogue,
// acuity maths, session history, exports, a safe Markdown subset, toasts and theme.

const HISTORY_KEY = "repolens-session-history";
const THEME_KEY = "repolens-theme";

// One entry per built-in check. `measures` explains the line of the chart;
// `fix` is keyed by status; `verify` is how a developer proves the fix.
const CATALOGUE = {
  readme: {
    measures: "A root README exists and carries real content: at least 300 characters.",
    fix: { pass: "Keep the README current as the project changes.", warn: "Expand the README past 300 characters with purpose, install, usage and development notes.", fail: "Add README.md at the repository root with purpose, install and usage instructions." },
    verify: "wc -c README.md",
  },
  license: {
    measures: "Reuse terms are declared through a LICENSE, LICENCE or COPYING file at the root.",
    fix: { pass: "No action needed.", warn: "Choose a license, save its official text as LICENSE at the root, and mention it in the README." },
    verify: "ls LICENSE*",
  },
  gitignore: {
    measures: "A .gitignore keeps build output, environments and local secrets out of version control.",
    fix: { pass: "No action needed.", warn: "Add a .gitignore for your ecosystem, then untrack artifacts with git rm -r --cached <path>." },
    verify: "git status --ignored",
  },
  tests: {
    measures: "Automated test files exist (any .py, .js, .ts, .java, .go or .rs file with 'test' in its name).",
    fix: { pass: "No action needed.", fail: "Add a test suite next to the code and run it in CI so regressions block merges." },
    verify: "git ls-files | grep -i test",
  },
  ci: {
    measures: "A pipeline is configured: GitHub Actions, GitLab CI, Azure Pipelines or a Jenkinsfile.",
    fix: { pass: "No action needed.", warn: "Add .github/workflows/ci.yml that installs dependencies and runs tests on push and pull_request." },
    verify: "ls .github/workflows",
  },
  todos: {
    measures: "TODO, FIXME, HACK and XXX markers across text files. More than 10 is a warning.",
    fix: { pass: "No action needed.", warn: "Resolve finished markers and move real follow-ups into tracked issues until 10 or fewer remain." },
    verify: "git grep -nE \"\\b(TODO|FIXME|HACK|XXX)\\b\"",
  },
  "large-files": {
    measures: "No committed file is larger than 5 MB.",
    fix: { pass: "No action needed.", warn: "Move large binaries to Git LFS or release assets, purge them from history, and add ignore rules." },
    verify: "git ls-files -z | xargs -0 du -h | sort -rh | head",
  },
  secrets: {
    measures: "No AWS keys, private key blocks, or password/token/api_key literals in tracked text.",
    fix: { pass: "No action needed.", fail: "Revoke and rotate each credential first, then remove the literal, load it from the environment, and purge history." },
    verify: "git grep -nE \"(api[_-]?key|secret|token|password)\\s*[:=]\"",
  },
};

const STATUS = {
  pass: { label: "Clear", glyph: "●", word: "pass" },
  warn: { label: "Advisory", glyph: "◐", word: "warn" },
  fail: { label: "Blocking", glyph: "○", word: "fail" },
};

const SNELLEN = [20, 25, 32, 40, 50, 63, 80, 100, 125, 160, 200];

function guidanceFor(check) {
  return CATALOGUE[check.id]?.fix[check.status] || check.detail;
}

// Map a 0-100 health score onto a logMAR line: 100 reads the 20/20 line, 0 reads 20/200.
function acuity(score) {
  const logmar = Math.min(1, Math.max(0, Math.round((100 - score) / 10) / 10));
  const step = Math.round(logmar * 10);
  const verdict = logmar === 0 ? "Sharp" : logmar <= 0.2 ? "Slight blur" : logmar <= 0.5 ? "Blurred" : "Severe blur";
  return { logmar, snellen: `20/${SNELLEN[step]}`, verdict };
}

function counts(report) {
  return report.checks.reduce((total, check) => ({ ...total, [check.status]: total[check.status] + 1 }), { pass: 0, warn: 0, fail: 0 });
}

function prioritizedChecks(report) {
  const rank = (check) => (check.id === "secrets" && check.status === "fail" ? 0 : check.status === "fail" ? 1 : 2);
  return report.checks.filter((check) => check.status !== "pass").sort((first, second) => rank(first) - rank(second));
}

function repoName(report) {
  return report.root.replace(/^github\.com\//, "");
}

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", "\"": "&quot;" }[character]));
}

function formatDate(iso, options = { dateStyle: "medium", timeStyle: "short" }) {
  return new Date(iso).toLocaleString([], options);
}

// --- Session history (per-browser convenience; never shared) ---------------

function loadHistory() {
  try {
    const entries = JSON.parse(sessionStorage.getItem(HISTORY_KEY) || "[]");
    return Array.isArray(entries) ? entries.filter((entry) => entry?.report?.checks) : [];
  } catch {
    return [];
  }
}

function storeHistory(entries) {
  try {
    if (entries.length) sessionStorage.setItem(HISTORY_KEY, JSON.stringify(entries));
    else sessionStorage.removeItem(HISTORY_KEY);
  } catch {
    // Storage can be unavailable (private windows, blocked site data); history is optional.
  }
}

function saveToHistory(report, url) {
  const entry = { id: `${Date.now()}`, url, report, scannedAt: new Date().toISOString() };
  const entries = [entry, ...loadHistory().filter((item) => item.url !== url)].slice(0, 12);
  storeHistory(entries);
  return entries;
}

// --- Shared markup ----------------------------------------------------------

function statusMark(status) {
  const meta = STATUS[status];
  return `<span class="status status-${status}"><span class="status-glyph" aria-hidden="true">${meta.glyph}</span>${meta.label}</span>`;
}

// Kodak Q-13 style control strip: one numbered patch per check.
function patchStrip(report, { compact = false } = {}) {
  return `<ol class="patches${compact ? " patches-compact" : ""}" aria-label="Check status strip">${report.checks.map((check, index) => `
    <li class="patch patch-${check.status}" title="${escapeHtml(`${check.title}: ${STATUS[check.status].label}`)}">
      <span class="patch-swatch" aria-hidden="true"></span>
      <span class="patch-no">${String(index + 1).padStart(2, "0")}</span>
      ${compact ? "" : `<span class="patch-id">${escapeHtml(check.id)}</span>`}
      <span class="visually-hidden">${escapeHtml(check.title)}: ${STATUS[check.status].label}</span>
    </li>`).join("")}</ol>`;
}

function evidenceList(check) {
  if (!check.locations?.length) return "";
  return `<ul class="evidence">${check.locations.map((location) => `<li><code>${escapeHtml(location)}</code></li>`).join("")}</ul>`;
}

// The prescription: every non-passing check as a numbered line with its fix.
function prescription(report, scannedAt = new Date().toISOString()) {
  const items = prioritizedChecks(report);
  const lines = items.length ? items.map((check, index) => `
    <li class="rx-line">
      <span class="rx-no">${String(index + 1).padStart(2, "0")}</span>
      <div class="rx-body">
        <div class="rx-head"><strong>${escapeHtml(check.title)}</strong>${statusMark(check.status)}</div>
        <p class="rx-detail">${escapeHtml(check.detail.split("; locations:")[0].split("; affected:")[0])}</p>
        <p class="rx-fix">${escapeHtml(guidanceFor(check))}</p>
        ${evidenceList(check)}
        <p class="rx-verify"><span>Verify</span><code>${escapeHtml(CATALOGUE[check.id]?.verify || "")}</code></p>
      </div>
    </li>`).join("") : `<li class="rx-line rx-clear"><span class="rx-no">—</span><div class="rx-body"><strong>No corrective lenses required.</strong><p class="rx-fix">Every line of the chart reads clearly. Keep documentation, tests and CI in step as the project grows.</p></div></li>`;
  return `
    <div class="rx-meta">
      <div><span class="label">Patient</span><strong>${escapeHtml(repoName(report))}</strong></div>
      <div><span class="label">Acuity</span><strong>${acuity(report.score).snellen}</strong></div>
      <div><span class="label">Examined</span><strong>${escapeHtml(formatDate(scannedAt, { dateStyle: "medium" }))}</strong></div>
    </div>
    <ol class="rx-lines">${lines}</ol>
    <div class="rx-sign"><span>Examiner: RepoLens</span><span class="rx-signature" aria-hidden="true"></span><span>Repository-level signals, not a security certification.</span></div>`;
}

// --- Exports ----------------------------------------------------------------

function reportMarkdown(report) {
  const sight = acuity(report.score);
  const lines = [`# RepoLens examination: ${report.root}`, "", `**Health:** ${report.score}/100 · **Acuity:** ${sight.snellen} (${sight.verdict})`, "", "## Lines of the chart", ""];
  report.checks.forEach((check, index) => {
    lines.push(`${index + 1}. **${STATUS[check.status].label}: ${check.title}** (\`${check.id}\`)`, `   - ${check.detail}`);
    (check.locations || []).forEach((location) => lines.push(`   - Location: \`${location}\``));
  });
  lines.push("", "## Prescription", "");
  const actions = prioritizedChecks(report);
  if (!actions.length) lines.push("No corrective lenses required. All checks pass.");
  actions.forEach((check) => lines.push(`- [ ] **${check.title}:** ${guidanceFor(check)}`, `  - Verify: \`${CATALOGUE[check.id]?.verify || ""}\``));
  return lines.join("\n");
}

function download(filename, text) {
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([text], { type: "text/markdown;charset=utf-8" }));
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

function exportMarkdown(report) {
  const name = report.root.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "") || "repolens-report";
  download(`${name}-examination.md`, reportMarkdown(report));
  toast("Examination saved as Markdown");
}

function exportPdf(report, scannedAt) {
  const popup = window.open("", "_blank");
  if (!popup) {
    toast("Allow pop-ups to print the prescription", "error");
    return;
  }
  const styles = [...document.styleSheets].map((sheet) => sheet.href).filter(Boolean).map((href) => `<link rel="stylesheet" href="${escapeHtml(href)}">`).join("");
  popup.document.write(`<!doctype html><html lang="en" data-theme="light"><head><meta charset="utf-8"><title>RepoLens prescription · ${escapeHtml(repoName(report))}</title>${styles}</head><body class="print-sheet"><section class="rx">${prescription(report, scannedAt)}</section></body></html>`);
  popup.document.close();
  popup.addEventListener("load", () => { popup.focus(); popup.print(); });
}

// --- A small, safe Markdown subset for advisor answers ---------------------
// Everything is escaped first; only code, bold, italics and lists are re-introduced.

function inlineMarkdown(text) {
  return text
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, "$1<em>$2</em>");
}

function renderMarkdown(source) {
  const blocks = [];
  const fenced = escapeHtml(source).replace(/```[^\n]*\n([\s\S]*?)```/g, (_, code) => {
    blocks.push(`<pre><code>${code.replace(/\n$/, "")}</code></pre>`);
    return `\u0000${blocks.length - 1}\u0000`;
  });
  return fenced.split(/\n{2,}/).map((chunk) => {
    const trimmed = chunk.trim();
    if (!trimmed) return "";
    if (/^\u0000\d+\u0000$/.test(trimmed)) return trimmed;
    const lines = trimmed.split("\n");
    if (lines.every((line) => /^\s*[-*] /.test(line))) return `<ul>${lines.map((line) => `<li>${inlineMarkdown(line.replace(/^\s*[-*] /, ""))}</li>`).join("")}</ul>`;
    if (lines.every((line) => /^\s*\d+[.)] /.test(line))) return `<ol>${lines.map((line) => `<li>${inlineMarkdown(line.replace(/^\s*\d+[.)] /, ""))}</li>`).join("")}</ol>`;
    return `<p>${lines.map(inlineMarkdown).join("<br>")}</p>`;
  }).join("").replace(/\u0000(\d+)\u0000/g, (_, index) => blocks[Number(index)]);
}

// --- Toasts -------------------------------------------------------------------

function toast(message, tone = "info") {
  let shelf = document.querySelector(".toasts");
  if (!shelf) {
    shelf = document.createElement("div");
    shelf.className = "toasts";
    shelf.setAttribute("role", "status");
    shelf.setAttribute("aria-live", "polite");
    document.body.append(shelf);
  }
  const slip = document.createElement("div");
  slip.className = `toast toast-${tone}`;
  slip.innerHTML = `<span class="toast-mark" aria-hidden="true">${tone === "error" ? "!" : "✓"}</span><span>${escapeHtml(message)}</span>`;
  shelf.append(slip);
  setTimeout(() => slip.classList.add("is-leaving"), 3200);
  setTimeout(() => slip.remove(), 3600);
}

// --- Theme --------------------------------------------------------------------

function readTheme() {
  try { return localStorage.getItem(THEME_KEY) || "auto"; } catch { return "auto"; }
}

function applyTheme(theme) {
  if (theme === "auto") document.documentElement.removeAttribute("data-theme");
  else document.documentElement.dataset.theme = theme;
  document.querySelectorAll("[data-theme-choice]").forEach((button) => button.setAttribute("aria-pressed", String(button.dataset.themeChoice === theme)));
}

function initTheme() {
  applyTheme(readTheme());
  document.querySelectorAll("[data-theme-choice]").forEach((button) => button.addEventListener("click", () => {
    const theme = button.dataset.themeChoice;
    try { localStorage.setItem(THEME_KEY, theme); } catch { /* per-viewer convenience only */ }
    applyTheme(theme);
  }));
}

initTheme();
