# Repolens Project Outline and Roadmap

## What Repolens Is

Repolens is a lightweight repository-health auditor. It inspects a local project, reports a small set of maintainability and safety signals, and gives developers a prioritized starting point for improving the repository. Its core is Python's standard library, so the command-line tool has no runtime dependencies and can run in a basic CI environment.

The product has two ways to use the same health checks:

- A command-line interface for local audits, scripts, and CI gates.
- A browser dashboard that can analyze a public GitHub repository archive and display the results.

The dashboard also has an optional Gemini-powered advisor. It can turn a report into a plain-language summary, recommendations, and an ordered remediation workflow. The core audit remains useful when the AI feature is not configured or available.

## Who It Is For

- Individual developers who want a quick baseline for a new or existing repository.
- Maintainers who want a repeatable, small CI health gate.
- Contributors who need a concrete list of repository-level improvements.
- Developers exploring a project through a report rather than reading every configuration file first.

Repolens is not currently a replacement for language-specific static analysis, dependency vulnerability scanners, secret-scanning services, code review, or a full CI platform. Its checks are repository-level signals and should be presented as such.

## Current Capabilities

### Repository inspection

- Walks a repository and caches its file listing for reuse across checks.
- Skips common version-control, virtual-environment, cache, dependency, and build directories.
- Reads a curated set of text file types with a size cap and tolerates unreadable files.
- Runs registered checks in a stable order and supports running only selected checks.

### Built-in checks

- README presence and minimum substance.
- License declaration.
- Presence and rule count of a `.gitignore` file.
- Presence of recognized automated-test files.
- Presence of common CI pipeline configuration.
- Counts TODO/FIXME/HACK/XXX markers and warns above a threshold.
- Finds files above a fixed size limit.
- Scans text files for a small set of credential-like patterns and reports locations.

Each check returns `pass`, `warn`, or `fail`. The score averages those statuses using pass = 1, warn = 0.5, and fail = 0. This is a simple summary signal, not a calibrated measure of software quality.

### CLI and reports

- Audits the current directory or a supplied path.
- Emits human-readable text or JSON.
- Lists checks, filters by check ID, and supports strict mode for CI.
- Uses exit codes suitable for scripting: 0 for healthy, 1 for a failed check or strict warning, and 2 for an invalid path or check selection.

### Browser dashboard

- Serves a dependency-free static frontend with the Python standard-library HTTP server.
- Accepts a public GitHub repository URL, downloads its archive, extracts it to a temporary directory, and runs the same registered checks.
- Reports progress for repository analysis and AI-analysis jobs.
- Shows check details and available evidence locations.
- Keeps up to 12 scan reports in browser `sessionStorage` for the current browser session.
- Provides Markdown and print-to-PDF report exports.

### AI advisor

- Uses the `GEMINI_API_KEY` environment variable; the key must never be committed or embedded in the application.
- Sends a condensed report to Gemini and expects structured JSON containing a summary, recommendations, and workflow steps.
- Retries selected transient API errors and reports failures through the dashboard job status.
- Keeps the rest of Repolens functional without AI credentials or external AI access.
- The dashboard's quick advisor prompts are currently local, keyword-routed guidance. The explicit AI request is the part that invokes Gemini; do not imply every free-form chat message is currently sent to the model.

## Architecture

1. `repolens/repo.py` provides the ignore-aware filesystem view and file-reading helpers.
2. `repolens/checks.py` defines result and status types, the check registry, execution, and score calculation.
3. `repolens/builtin_checks.py` registers the built-in repository checks.
4. `repolens/report.py` renders CLI text and JSON reports.
5. `repolens/cli.py` owns argument parsing, output selection, and process exit behavior.
6. `repolens/web.py` serves the dashboard, downloads GitHub archives, runs analysis jobs, and exposes report and AI job endpoints.
7. `repolens/ai.py` builds the AI prompt, calls Gemini, validates its structured response, and handles retries.
8. `frontend/` contains the dashboard and history experiences, report rendering, local guidance, and exports.
9. `tests/` covers built-in checks, CLI behavior, AI request/response behavior with mocked network calls, and GitHub URL validation.
10. `.github/skills/add-check/SKILL.md` captures the repository's workflow for adding a new health check.

## Product Principles

- Keep the core CLI small, predictable, dependency-free, and useful offline.
- Make every finding explainable: show what was checked, why it received its status, and what evidence is available.
- Treat scores as a navigation aid, not a guarantee or quality certification.
- Make network access explicit and bounded, especially for remote repository archives and AI requests.
- Keep credentials outside source control and send only the minimum report context needed by an optional AI provider.
- Make recommendations actionable, ordered, and traceable to actual check results.
- Prefer extensible checks and clear tests over a large list of shallow heuristics.

## Roadmap

### Phase 1: Trustworthy baseline

**Goal:** Make current results easier to trust and safer to interpret.

- Clarify the distinction between deterministic local advisor hints and Gemini-generated guidance in the dashboard and README.
- Improve report structure so checks can return structured evidence rather than requiring locations to be parsed from human-readable detail strings.
- Add input validation and response-shape validation for externally supplied reports and AI responses.
- Add tests for web job creation, job completion/error states, archive limits, archive path traversal defense, and AI timeout behavior.
- Review the secret detector's supported formats and false-positive/false-negative boundaries; document that it is heuristic and not a full secret scanner.
- Make API failures legible to users without exposing credentials, request URLs containing secrets, or unnecessary provider response details.

**Done when:** report output remains backward-compatible where practical, web and AI errors have focused tests, and every result clearly separates status, detail, and evidence.

### Phase 2: Useful CI and automation

**Goal:** Make Repolens straightforward to adopt in existing workflows.

- Add machine-readable options for selecting checks and handling warning thresholds in CI.
- Publish a documented GitHub Actions example and a minimal reusable workflow if maintenance cost is acceptable.
- Add stable JSON schema/versioning so downstream tools can consume reports safely.
- Define a policy for exit behavior and score changes, then test it as a public CLI contract.
- Add packaging smoke tests for editable installation and the `repolens` console script.

**Done when:** a new user can install the package, add one CI step, and understand exactly what will make that step fail.

### Phase 3: Better analysis evidence

**Goal:** Improve signal quality without turning Repolens into a broad, noisy scanner.

- Add checks only when they are portable, explainable, and testable across repositories.
- Consider dependency-manifest presence and basic configuration checks before deeper ecosystem-specific analysis.
- Improve large-file reporting with a configurable threshold and structured paths/sizes.
- Make ignore rules configurable and explain which directories were skipped.
- Add check metadata such as severity, category, and remediation link so CLI, web, and exports share one source of truth.
- Allow thresholds to be configured through a repository config file while retaining sensible defaults.

**Done when:** configuration is documented and deterministic, and every new check has clear fixtures for pass, warn, fail, and boundary behavior as applicable.

### Phase 4: Report history and comparison

**Goal:** Help maintainers see whether repository health is improving over time.

- Move beyond session-only browser history with an explicit, privacy-conscious persistence option.
- Add report comparison for score and per-check status changes.
- Preserve timestamps, repository identity, and tool/report schema versions in exported reports.
- Offer useful trend summaries without treating score movement as proof of improved code quality.
- Keep local data controls clear, including deletion and retention behavior.

**Done when:** users can compare two scans of the same repository and identify which checks changed, without silently uploading reports to a service.

### Phase 5: Guided remediation

**Goal:** Turn findings into a reviewable plan while keeping developers in control.

- Connect advisor output to structured findings and evidence, with each recommendation citing relevant check IDs and locations.
- Improve prompt handling so AI guidance is relevant to the selected check or question rather than only the whole report.
- Show clear loading, retry, timeout, missing-key, and provider-error states.
- Make generated workflows editable/exportable as Markdown or issue/task lists.
- Require user review before any future feature modifies repository files or creates remote issues.
- Evaluate outputs against representative fixtures for correctness, prioritization, and unsupported claims.

**Done when:** guidance is grounded in report evidence, users can inspect and export it, and no code or remote issue is changed without explicit confirmation.

### Phase 6: Sustainable release quality

**Goal:** Make the project reliable to install, maintain, and extend.

- Establish a release checklist for versioning, changelog notes, tests, package build, and artifact inspection.
- Test supported Python versions in CI and document the support policy.
- Add lightweight performance checks for large repositories and document current resource limits.
- Keep generated packaging metadata out of the source-of-truth workflow; build artifacts should be reproducible from tracked project files.
- Review whether the standard-library-only constraint still serves users before adding a runtime dependency.

**Done when:** a clean checkout can be tested and packaged reproducibly, and a release can be made from a documented process.

## Suggested Near-Term Order

### Deferred Advisor Fixes (2026-10-05)

User-reported issue: the advisor responds to the initial request, but subsequent follow-up questions repeat the same answer instead of addressing the new question. Deferred at the user's request; the cause is not yet confirmed.

- [ ] Reproduce repeated answers with a multi-turn conversation and capture the outgoing question, selected check, and conversation context without credentials.
- [ ] Check whether whole-report summary instructions override the latest question; make follow-ups answer that question without unnecessarily regenerating the original analysis and workflow.
- [ ] Verify that earlier answers and workflow steps retain their meaning in conversation history, including follow-ups such as "explain step two" and requests for more specific verification commands.
- [ ] Add regression coverage for initial analysis followed by distinct questions, including references to earlier steps and switching between repositories.
- [ ] Verify in the browser with live Gemini responses that distinct follow-ups receive relevant answers, while retries resend only the intended question.

**Acceptance criteria:** after an initial analysis, at least two distinct follow-ups produce relevant, context-aware answers rather than repeating the original response. Tests must check question and context handling, not merely that an API response is returned.

### Other Near-Term Work

1. Strengthen tests around web jobs and GitHub archive handling.
2. Formalize a structured check-evidence model and update JSON rendering.
3. Improve AI error states and link recommendations to check IDs/evidence.
4. Add CI adoption examples and package installation smoke tests.
5. Add report comparison only after report schema/versioning is defined.

## Risks and Boundaries

- Heuristic checks can miss issues or report false positives; findings should not be described as a security certification.
- A public repository archive can contain hostile or malformed paths and unusually large content; size limits and safe extraction checks are important.
- AI output can be incorrect or overly broad; it must be labeled as guidance and tied back to deterministic evidence.
- Reports may contain repository paths, filenames, and potentially sensitive findings. AI requests should be opt-in, secrets should not be sent, and user-facing privacy behavior should be explicit.
- The health score gives equal weight to checks and can hide important individual failures. The dashboard should emphasize failing checks and evidence, not only the aggregate score.
- The project depends on users supplying their own AI credentials. Credentials belong in environment variables or a secret manager and must never appear in roadmap files, reports, source code, or logs.

## Roadmap File Location

This file is stored in `repolens.egg-info/` at the requested location and explicitly included in version control. The rest of that directory remains ignored by `.gitignore`. Packaging tools may remove or replace files in this generated directory; a future cleanup should move this tracked roadmap to the repository root while preserving its history.
