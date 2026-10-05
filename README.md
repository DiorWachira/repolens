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

Vendor and build directories (`.git`, `node_modules`, `.venv`, `dist`, `build`, `__pycache__`, …) are skipped everywhere.

## Development

```bash
python -m unittest discover -s tests -v
python -m repolens .
```

### Frontend dashboard

The project includes a browser dashboard served by the standard-library web server:

```bash
python -m repolens.web --port 8000
```

Open `http://127.0.0.1:8000` and enter a public GitHub repository URL. The server downloads and analyzes its archive locally, showing download, extraction and per-check progress. Downloads allow up to 60 seconds, and each analysis can run for up to 180 seconds. Local folders are audited through the CLI; the dashboard does not automatically load CLI output. Scan history stays in browser session storage. Fonts and icons load from external CDNs.

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

The configuration indicator only confirms that a key is present, not that Google will accept it. The default model is `gemini-3.1-flash-lite`, verified with structured advisor requests. Set `GEMINI_MODEL` to use another available model. The `gemini-flash-latest` alias can route to a high-demand model and repeatedly return HTTP 503 even when the key works with Flash-Lite. If you previously set that override, remove it to use the default and restart the server. Authentication errors, unavailable models, quota limits, connection failures, and provider outages appear in the conversation with a retry action. AI jobs expire after 120 seconds; cancelling in the browser stops waiting but cannot retract an API request already sent.

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
├── frontend/               # dependency-free dashboard, history page, exports
├── tests/
└── .github/
    ├── skills/add-check/  # agent skill for extending the tool
    └── workflows/ci.yml
```

## License

MIT — see [LICENSE](LICENSE).
