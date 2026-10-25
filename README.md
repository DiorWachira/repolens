# repolens

Audit any repository from the command line and get a health report — README quality, licensing, tests, CI, TODO debt, oversized files and hardcoded secrets.

Pure Python standard library: no dependencies, nothing to install in CI beyond Python itself.

## Quick start

```bash
git clone https://github.com/<you>/repolens.git
cd repolens
python -m repolens .
```

```
repolens report for /home/you/projects/repolens

  PASS  readme       README present and substantial - README.md, 3187 chars
  PASS  license      LICENSE declared - LICENSE
  PASS  gitignore    Ignore file configured - 11 rules
  PASS  tests        Automated tests exist - 2 test files
  PASS  ci           Continuous integration configured - 1 pipeline files
  PASS  todos        Unresolved TODO markers - 10 markers
  PASS  large-files  No oversized files committed - none over 5 MB
  PASS  secrets      No hardcoded secrets - no credential-like literals found

Health 100/100  (8 pass, 0 warn, 0 fail)
```

Install it as a real command with `pip install -e .`, then run `repolens <path>` from anywhere.

## Usage

```bash
repolens                        # audit the current directory
repolens ../other-project       # audit somewhere else
repolens . --only secrets tests # run selected checks
repolens . --json               # machine-readable output
repolens . --strict             # exit 1 on warnings too
repolens --list                 # show available checks
```

**Exit codes:** `0` healthy, `1` a check failed (or warned under `--strict`), `2` bad arguments. That makes it usable as a CI gate:

```yaml
- run: python -m repolens . --strict
```

## Checks

| id | What it means | Warns | Fails |
| --- | --- | --- | --- |
| `readme` | A root README exists and has real content | under 300 characters | missing |
| `license` | Reuse terms are declared | no LICENSE/COPYING file | — |
| `gitignore` | Build noise is excluded from version control | no `.gitignore` | — |
| `tests` | The project has automated tests | — | no test files found |
| `ci` | A CI pipeline is configured | no GitHub Actions, GitLab CI, Azure Pipelines or Jenkinsfile | — |
| `todos` | Tracked TODO/FIXME/HACK/XXX debt | more than 10 markers | — |
| `large-files` | Binaries and dumps are not committed | any file over 5 MB | — |
| `secrets` | No credential-like literals in tracked text | — | AWS keys, private key blocks, or `password`/`token`/`api_key` assigned a literal value |

Scoring is `pass = 1`, `warn = 0.5`, `fail = 0`, averaged and reported out of 100.

Each result has a short `detail` summary and an `evidence` list with the specific locations behind it: `path:line (kind)` for `secrets` and `path (size)` for `large-files`. The text report prints evidence indented under its check, and `--json` emits it as an `evidence` array on every check (empty when there is nothing to point at).

Vendor and build directories (`.git`, `node_modules`, `.venv`, `dist`, `build`, `__pycache__`, …) are skipped everywhere.

## Development

```bash
python -m unittest discover -s tests -v
python -m repolens .
```

### Browser tests

`e2e/` holds Playwright smoke tests for the dashboard. They are dev and CI only; the app itself still has no JavaScript dependencies. The real Python server serves the pages, while GitHub and Gemini responses are mocked, so the suite runs offline at desktop and phone widths:

```bash
cd e2e
npm ci
npx playwright install chromium
npx playwright test
```

### Frontend dashboard

The project includes a browser dashboard served by the standard-library web server:

```bash
python -m repolens.web --port 8000
```

Open `http://127.0.0.1:8000` and enter a public GitHub repository URL. The server downloads and analyzes its archive locally, showing download, extraction and per-check progress. Downloads allow up to 60 seconds, and each analysis can run for up to 180 seconds. Local folders are audited through the CLI; the dashboard does not automatically load CLI output. Case files (scan history) stay in browser session storage.

The interface is designed around one idea, **a repository examined like an eye**:

- **Acuity chart.** The hero is a Bailey–Lovie logMAR chart. The health score maps onto it (100 reads 20/20, 0 reads 20/200), and lines finer than the repository's acuity blur out.
- **Control strip.** One numbered patch per check, after the Kodak Q-13 colour control patches.
- **Resolution-target progress.** Progress is shown with USAF-1951 bar triplets.
- **Prescription (℞).** The remediation plan, with a verify command per line.
- **The Examiner.** The advisor, presented as a consultation transcript.

The palette is paper and ink plus one signal colour: cobalt, after the slit lamp's cobalt-blue filter, reserved for the primary action and current focus. Status colours were checked with a colour-vision-deficiency validator in both themes and always pair a glyph with a label. Type is Optician Sans (built from Louise Sloan's optotypes, SIL OFL, self-hosted in `frontend/fonts`), Newsreader and IBM Plex Sans/Mono from Google Fonts. Light, dark and system themes are available.

Archives come from `codeload.github.com`, which is not subject to the REST API's 60-requests-per-hour limit. An archive must be at most 50 MB compressed, expand to at most 300 MB, and contain at most 20,000 entries.

### Deploying (Render)

The repository ships a [Render Blueprint](render.yaml) for a free Python web service. Nothing needs to be installed.

1. In Render, choose **New → Blueprint** and select this repository.
2. When prompted, paste your `GEMINI_API_KEY`. It is stored as a Render secret. Leave it blank to deploy with the offline examiner only.
3. Deploy. Every push to `main` redeploys automatically, and `/healthz` is the health check.

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` / `HOST` | `8000` / `127.0.0.1` | Listening address. Render sets `PORT`; the blueprint binds `0.0.0.0`. Also available as `--port` / `--host`. |
| `GEMINI_API_KEY` | unset | Enables the Gemini examiner. |
| `GEMINI_MODEL` | `gemini-3.5-flash` | Preferred model; the fallback chain still applies. |
| `REPOLENS_REPORTS_PER_WINDOW` | `12` | Examinations per client per 10 minutes (`0` disables). |
| `REPOLENS_QUESTIONS_PER_WINDOW` | `40` | Examiner questions per client per 10 minutes (`0` disables). Protects your Gemini quota. |
| `REPOLENS_TRUST_PROXY` | off | Use the first `X-Forwarded-For` hop as the client address. Enable only behind a trusted proxy (the blueprint does). |

Free Render instances sleep after inactivity, so the first request can take up to a minute. Jobs and rate limits are held in memory, so they reset on restart, and the blueprint pins the service to a single instance. If the server restarts mid-examination, the dashboard notices the lost job and re-runs the examination once. A lost examiner answer shows a Retry button.

### AI-guided analysis (optional)

The repository advisor sends questions, selected-check context, and recent conversation to the [Google Gemini API](https://aistudio.google.com/apikey). It returns a direct answer, recommendations, and a remediation workflow. API access, quotas, and pricing depend on your Google project and model:

1. Create an API key at <https://aistudio.google.com/apikey> and check the project's model access and quota.
2. Set it as an environment variable before starting the server - never commit it or paste it into chat:

   ```powershell
   $env:GEMINI_API_KEY = "your-key-here"
   python -m repolens.web --port 8000
   ```

3. Open **Repository advisor**, select **Gemini**, and send a question or choose a prompt. Check details also have an **Ask advisor** action. **Export plan** downloads the latest successful response as a Markdown checklist.

On Windows, the server also checks the saved current-user `GEMINI_API_KEY` environment value when the process environment has no key. This handles VS Code sessions started before the user variable was saved. A nonempty process variable takes precedence; replace it or restart the parent application if it contains an old key. No credential is returned to the browser or added to request URLs.

The configuration indicator only confirms that a key is present, not that Google will accept it. The default model is `gemini-3.5-flash`. If it is busy, rate limited, retired or too slow, the advisor falls back to `gemini-3.5-flash-lite` and then `gemini-flash-lite-latest`, and the answer shows which model replied. Set `GEMINI_MODEL` to try another model first. Authentication and permission errors stop immediately instead of falling back. AI jobs expire after 120 seconds; cancelling in the browser stops waiting but cannot retract an API request already sent.

The advisor holds a real conversation. The report is sent once as context, earlier turns are replayed as user and model messages, and the check you have open is sent as structured focus. Follow-up questions get a direct answer. A full remediation workflow, with a verification step for each item, appears only when you ask for a review or a plan. Each answer suggests a few follow-up questions.

Select **Local guide** for deterministic, offline guidance instead of a model request. Gemini requests are explicit: the report and up to six recent conversation messages are sent to Google. Do not enter secrets. Generated guidance is advisory, may be incorrect, and never executes commands or edits a repository.

This feature is entirely optional - every other repolens feature works with zero API keys and zero external services.

### Adding a check

The repo ships an agent skill that encodes the whole workflow — check contract, test fixture pattern, docs update and verification steps. In an agent-enabled editor run:

```
/add-check <check-id>
```

It resolves to [.github/skills/add-check/SKILL.md](.github/skills/add-check/SKILL.md), which you can also just read and follow by hand. In short: register the function with `@check(id, title)` in [repolens/builtin_checks.py](repolens/builtin_checks.py), cover every status it can return in [tests/test_checks.py](tests/test_checks.py), and add a row to the table above.

## Project layout

```
repolens/
├── repolens/
│   ├── repo.py            # cached, ignore-aware filesystem view
│   ├── checks.py          # registry, CheckResult, scoring
│   ├── builtin_checks.py  # the checks themselves
│   ├── report.py          # text and JSON rendering
│   ├── cli.py             # argument parsing and exit codes
│   ├── web.py             # browser dashboard server and job APIs
│   └── ai.py              # optional Gemini-powered analysis and recommendations
├── frontend/              # dependency-free dashboard, case files, 404, exports, self-hosted font
├── tests/
└── .github/
    ├── skills/add-check/  # agent skill for extending the tool
    └── workflows/ci.yml
```

## License

MIT — see [LICENSE](LICENSE).
