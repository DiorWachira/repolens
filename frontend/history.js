// Case files: the register of this session's examinations and a reader for one of them.

const elements = {
  list: document.querySelector("#historyList"),
  summary: document.querySelector("#historySummary"),
  clear: document.querySelector("#clearHistory"),
  view: document.querySelector("#reportView"),
  title: document.querySelector("#reportTitle"),
  strip: document.querySelector("#reportStrip"),
  rx: document.querySelector("#reportRx"),
  markdown: document.querySelector("#markdownButton"),
  pdf: document.querySelector("#pdfButton"),
};

let entries = loadHistory();
let selected = null;

function selectEntry(entry, { scroll = true } = {}) {
  selected = entry;
  const { report } = entry;
  elements.view.hidden = false;
  elements.title.textContent = repoName(report);
  const sight = acuity(report.score);
  elements.strip.innerHTML = `
    <div class="record-grid">
      <div class="readout"><span class="label">Health</span><p class="readout-score"><span>${report.score}</span><small>/100</small></p>
        <dl class="readout-meta"><div><dt>Acuity</dt><dd>${sight.snellen}</dd></div><div><dt>logMAR</dt><dd>${sight.logmar.toFixed(1)}</dd></div><div><dt>Reading</dt><dd>${sight.verdict}</dd></div></dl></div>
      <div class="strip-panel"><span class="label">Control strip · one patch per line</span>${patchStrip(report)}</div>
      <div class="specimen"><span class="label">Specimen</span><p class="specimen-name"><a href="https://${escapeHtml(report.root)}" target="_blank" rel="noopener">${escapeHtml(repoName(report))}</a></p>
        <dl class="specimen-meta"><div><dt>Examined</dt><dd>${escapeHtml(formatDate(entry.scannedAt))}</dd></div>${Number.isInteger(report.profile?.files) ? `<div><dt>Files read</dt><dd>${report.profile.files.toLocaleString()}</dd></div>` : ""}</dl></div>
    </div>`;
  elements.rx.innerHTML = prescription(report, entry.scannedAt);
  history.replaceState(null, "", `history.html?id=${encodeURIComponent(entry.id)}`);
  renderRegister();
  if (scroll) elements.view.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
}

function renderRegister() {
  elements.summary.textContent = `${entries.length} examination${entries.length === 1 ? "" : "s"}`;
  elements.clear.hidden = !entries.length;
  if (!entries.length) {
    elements.list.innerHTML = '<p class="empty">No case files yet. <a href="./">Examine a repository</a> and it will be filed here for the rest of this session.</p>';
    return;
  }
  elements.list.innerHTML = `
    <table class="case-table">
      <thead><tr><th scope="col">Repository</th><th scope="col" class="hide-sm">Examined</th><th scope="col" class="hide-sm">Strip</th><th scope="col">Acuity</th><th scope="col" style="text-align:right">Score</th></tr></thead>
      <tbody>${entries.map((entry) => `
        <tr class="${selected?.id === entry.id ? "is-selected" : ""}">
          <td><a class="name" href="history.html?id=${encodeURIComponent(entry.id)}" data-entry="${escapeHtml(entry.id)}">${escapeHtml(repoName(entry.report))}</a></td>
          <td class="mono hide-sm">${escapeHtml(formatDate(entry.scannedAt, { dateStyle: "short", timeStyle: "short" }))}</td>
          <td class="hide-sm">${patchStrip(entry.report, { compact: true })}</td>
          <td class="mono">${acuity(entry.report.score).snellen}</td>
          <td class="num">${entry.report.score}</td>
        </tr>`).join("")}</tbody>
    </table>`;
}

elements.list.addEventListener("click", (event) => {
  const link = event.target.closest("[data-entry]");
  const entry = link && entries.find((item) => item.id === link.dataset.entry);
  if (!entry) return;
  event.preventDefault();
  selectEntry(entry);
});

elements.clear.addEventListener("click", () => {
  storeHistory([]);
  entries = [];
  selected = null;
  elements.view.hidden = true;
  history.replaceState(null, "", "history.html");
  renderRegister();
  toast("Case files cleared");
});

elements.markdown.addEventListener("click", () => selected && exportMarkdown(selected.report));
elements.pdf.addEventListener("click", () => selected && exportPdf(selected.report, selected.scannedAt));

renderRegister();
const requested = entries.find((item) => item.id === new URLSearchParams(location.search).get("id"));
if (requested) selectEntry(requested, { scroll: false });
