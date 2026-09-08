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

The project includes a dependency-free browser dashboard for the JSON report:

```bash
python -m repolens . --json > frontend/report.json
python -m repolens.web --port 8000
```

Open `http://localhost:8000` to explore the current check results. The dashboard also accepts a public GitHub URL and analyzes its repository archive locally, showing download, extraction and per-check progress. Downloads allow up to 60 seconds, and each analysis can run for up to 180 seconds. Refresh the page after regenerating the report.

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
│   └── cli.py             # argument parsing and exit codes
├── tests/
└── .github/
    ├── skills/add-check/  # agent skill for extending the tool
    └── workflows/ci.yml
```

## License

MIT — see [LICENSE](LICENSE).
