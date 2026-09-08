---
name: add-check
description: 'Add a new repository health check to repolens. Use when the user says "add a check", "new check", "repolens check", or wants repolens to detect something new.'
argument-hint: '<check-id> - e.g. /add-check secrets'
---

# Add Check

Add a health check so `repolens` reports on a new aspect of a repository. Every check lands together with a test and a README row; this skill keeps those three in sync.

## When to Use

- The user wants repolens to detect something it does not cover yet (secrets, changelog, docs coverage, dependency pinning)
- An existing check needs a new status rule or threshold

Do not use for: changing the CLI surface, the report format, or the scoring rule - those live outside the check registry.

## Contract

A check is a function in [builtin_checks.py](../../../repolens/builtin_checks.py) that:

- is decorated with `@check("<id>", "<Title>")` - the id is kebab-case and permanent, because users pass it to `--only`
- takes a `Repo` and returns a `CheckResult(id, title, status, detail)`
- returns `Status.PASS`, `Status.WARN` (advisory) or `Status.FAIL` (a real defect - this makes the CLI exit 1)
- sets `detail` to a short factual string containing the number or path that justifies the status
- touches the filesystem only through `Repo` (`repo.files`, `repo.text_files`, `repo.find_top_level`, `repo.read_text`, `repo.size_of`) so ignore rules and size limits are respected

## Procedure

1. Pick the id and title. Kebab-case id, human-readable title. The registry raises on duplicate ids.
2. Decide the status rule before writing code: what passes, what is advisory (`WARN`), what is a genuine defect (`FAIL`). Reserve `FAIL` for things that should block CI.
3. Add the check to [builtin_checks.py](../../../repolens/builtin_checks.py). Put any threshold in a module-level constant beside the existing ones so it stays tunable and testable.

   ```python
   @check("changelog", "Changelog maintained")
   def changelog(repo: Repo) -> CheckResult:
       path = repo.find_top_level("changelog")
       if path is None:
           return CheckResult("changelog", "Changelog maintained", Status.WARN, "no CHANGELOG file")
       return CheckResult("changelog", "Changelog maintained", Status.PASS, str(path))
   ```

4. Add tests to [tests/test_checks.py](../../../tests/test_checks.py). Subclass `RepoFixture`, build a temp repo with `self.write(...)`, assert with `self.result("<id>")`. Cover every status the check can return - at minimum one pass and one non-pass.
5. Document it in the checks table in [README.md](../../../README.md): id, meaning, and when it warns or fails.
6. Verify from the repo root:

   ```powershell
   python -m unittest discover -s tests
   python -m repolens . --only <id>
   python -m repolens .
   ```

   The new id must appear in `python -m repolens --list` and in the report output.

## Notes

- Checks must never crash on unreadable files; `repo.read_text` already returns `""` on error.
- Checks are read-only. They must never write to the repository being inspected.
- Scoring is automatic (pass = 1, warn = 0.5, fail = 0), so adding near-duplicate checks silently double-weights one concern.

