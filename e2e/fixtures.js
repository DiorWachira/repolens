// Deterministic API responses so the browser tests never reach GitHub or Gemini.

const REPORT = {
  root: "github.com/example/demo",
  score: 81,
  checks: [
    { id: "readme", title: "README present and substantial", status: "pass", detail: "README.md, 2400 chars" },
    { id: "license", title: "LICENSE declared", status: "pass", detail: "LICENSE" },
    { id: "gitignore", title: "Ignore file configured", status: "pass", detail: "12 rules" },
    { id: "tests", title: "Automated tests exist", status: "pass", detail: "6 test files" },
    { id: "ci", title: "Continuous integration configured", status: "pass", detail: "1 pipeline files" },
    { id: "todos", title: "Unresolved TODO markers", status: "warn", detail: "14 markers across the codebase" },
    { id: "large-files", title: "No oversized files committed", status: "pass", detail: "none over 5 MB" },
    { id: "secrets", title: "No hardcoded secrets", status: "fail", detail: "1 suspected secret", locations: ["config/settings.py:12 (hardcoded credential)"] },
  ],
  profile: { files: 64, languages: [{ ext: ".py", count: 40 }, { ext: ".md", count: 6 }], top_level: ["README.md", "config/", "src/", "tests/"] },
};

const PLAN = {
  answer: "Rotate the credential in `config/settings.py` first, then trim the TODO backlog.",
  recommendations: [{ text: "Revoke and rotate the exposed credential.", checks: ["secrets"] }],
  workflow: [
    { title: "Rotate the credential", detail: "Revoke the key at its provider and issue a new one.", verify: "The old key is rejected." },
    { title: "Load it from the environment", detail: "Replace the literal with `os.environ`.", verify: "`git grep -n password` finds no literal." },
  ],
  follow_ups: ["How do I purge it from history?"],
  model: "gemini-test",
};

const FOLLOW_UP = {
  answer: "Use `git filter-repo --replace-text` and force-push.",
  recommendations: [],
  workflow: [],
  follow_ups: [],
  model: "gemini-test",
};

/** Route the job APIs to fixtures. Returns the bodies the page sent to /api/insights. */
async function mockApis(page, { report = REPORT, answers = [PLAN, FOLLOW_UP] } = {}) {
  const questions = [];
  let answerIndex = 0;
  // Keep tests offline and fast: system fallbacks replace the Google-hosted faces.
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (route) => route.abort());
  await page.route("**/api/ai/status", (route) => route.fulfill({ json: { configured: true, message: "Gemini configured", timeout_seconds: 120 } }));
  await page.route("**/api/report", (route) => route.fulfill({ status: 202, json: { job_id: "scan-1" } }));
  await page.route("**/api/report/scan-1*", (route) => route.fulfill({ json: { state: "complete", progress: 100, message: "Analysis complete", report } }));
  await page.route("**/api/insights", (route) => {
    questions.push(route.request().postDataJSON());
    route.fulfill({ status: 202, json: { job_id: `ask-${questions.length}` } });
  });
  await page.route("**/api/insights/ask-*", (route) => {
    const insights = answers[Math.min(answerIndex, answers.length - 1)];
    answerIndex += 1;
    route.fulfill({ json: { state: "complete", progress: 100, message: "done", insights } });
  });
  return questions;
}

module.exports = { REPORT, PLAN, FOLLOW_UP, mockApis };
