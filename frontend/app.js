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
  progressWrap: document.querySelector("#progressWrap"),
  progress: document.querySelector("#analysisProgress"),
  progressMessage: document.querySelector("#progressMessage"),
  progressPercent: document.querySelector("#progressPercent"),
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
  const deadline = Date.now() + 100000;
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
  throw new Error("Analysis timed out after 100 seconds");
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