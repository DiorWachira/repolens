const state = { report: null, filter: "all" };

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
  grid: document.querySelector("#checksGrid"),
};

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
      <div><h3>${check.title}</h3><p class="check-detail">${check.detail}</p></div>
      <span class="check-id">${check.id}</span>
    </article>
  `).join("");
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
  elements.formStatus.textContent = "Fetching archive and running checks...";
  try {
    const response = await fetch(`/api/report?url=${encodeURIComponent(url)}`);
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "Could not analyze repository");
    state.report = payload;
    elements.source.textContent = "source repository";
    elements.updated.textContent = payload.root;
    elements.formStatus.className = "form-status";
    elements.formStatus.textContent = "Analysis complete. Results below are from the public repository.";
    render();
  } catch (error) {
    elements.formStatus.className = "form-status error";
    elements.formStatus.textContent = error.message;
  }
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