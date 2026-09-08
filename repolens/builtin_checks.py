"""Built-in repository health checks.

Importing this module registers every check in `repolens.checks.REGISTRY`.
"""

from __future__ import annotations

import re

from repolens.checks import CheckResult, Status, check
from repolens.repo import Repo

MIN_README_CHARS = 300
TODO_WARN_THRESHOLD = 10
LARGE_FILE_BYTES = 5_000_000
MIN_SECRET_VALUE_CHARS = 8

TODO_PATTERN = re.compile(r"\b(TODO|FIXME|HACK|XXX)\b")

SECRET_PATTERNS = (
    ("aws access key", re.compile(r"AKIA[0-9A-Z]{16}")),
    ("private key block", re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----")),
    (
        "hardcoded credential",
        re.compile(
            r"(?i)(?:api[_-]?key|secret|token|password|passwd|access[_-]?key)\b"
            rf"\s*[:=]\s*['\"]([^'\"]{{{MIN_SECRET_VALUE_CHARS},}})['\"]"
        ),
    ),
)

# Values that look like a secret but are obviously a stand-in.
PLACEHOLDER_PATTERN = re.compile(
    r"(?i)^(?:your|my|xxx+|change_?me|placeholder|example|dummy|sample|secret|token|password|none|null)"
    r"|[<>${]|\*{3,}|\.\.\."
)


@check("readme", "README present and substantial")
def readme(repo: Repo) -> CheckResult:
    path = repo.find_top_level("readme")
    if path is None:
        return CheckResult("readme", "README present and substantial", Status.FAIL, "no README at repo root")
    length = len(repo.read_text(path))
    if length < MIN_README_CHARS:
        return CheckResult(
            "readme",
            "README present and substantial",
            Status.WARN,
            f"{path} is only {length} chars (want >= {MIN_README_CHARS})",
        )
    return CheckResult("readme", "README present and substantial", Status.PASS, f"{path}, {length} chars")


@check("license", "LICENSE declared")
def license_file(repo: Repo) -> CheckResult:
    path = repo.find_top_level("license", "licence", "copying")
    if path is None:
        return CheckResult("license", "LICENSE declared", Status.WARN, "no LICENSE file - reuse terms are unclear")
    return CheckResult("license", "LICENSE declared", Status.PASS, str(path))


@check("gitignore", "Ignore file configured")
def gitignore(repo: Repo) -> CheckResult:
    path = repo.find_top_level(".gitignore")
    if path is None:
        return CheckResult("gitignore", "Ignore file configured", Status.WARN, "no .gitignore")
    entries = [ln for ln in repo.read_text(path).splitlines() if ln.strip() and not ln.startswith("#")]
    return CheckResult("gitignore", "Ignore file configured", Status.PASS, f"{len(entries)} rules")


@check("tests", "Automated tests exist")
def tests(repo: Repo) -> CheckResult:
    test_files = [
        p
        for p in repo.files
        if "test" in p.name.lower() and p.suffix.lower() in {".py", ".js", ".ts", ".java", ".go", ".rs"}
    ]
    if not test_files:
        return CheckResult("tests", "Automated tests exist", Status.FAIL, "no test files found")
    return CheckResult("tests", "Automated tests exist", Status.PASS, f"{len(test_files)} test files")


@check("ci", "Continuous integration configured")
def ci(repo: Repo) -> CheckResult:
    workflows = [p for p in repo.files if p.as_posix().startswith(".github/workflows/")]
    others = [p for p in repo.files if p.name in {".gitlab-ci.yml", "azure-pipelines.yml", "Jenkinsfile"}]
    found = workflows + others
    if not found:
        return CheckResult("ci", "Continuous integration configured", Status.WARN, "no CI pipeline detected")
    return CheckResult("ci", "Continuous integration configured", Status.PASS, f"{len(found)} pipeline files")


@check("todos", "Unresolved TODO markers")
def todos(repo: Repo) -> CheckResult:
    count = sum(len(TODO_PATTERN.findall(repo.read_text(p))) for p in repo.text_files)
    if count > TODO_WARN_THRESHOLD:
        return CheckResult("todos", "Unresolved TODO markers", Status.WARN, f"{count} markers across the codebase")
    return CheckResult("todos", "Unresolved TODO markers", Status.PASS, f"{count} markers")


@check("large-files", "No oversized files committed")
def large_files(repo: Repo) -> CheckResult:
    offenders = [(p, repo.size_of(p)) for p in repo.files if repo.size_of(p) > LARGE_FILE_BYTES]
    if offenders:
        worst = max(offenders, key=lambda item: item[1])
        locations = "; ".join(f"{path} ({size // 1_000_000} MB)" for path, size in offenders)
        return CheckResult(
            "large-files",
            "No oversized files committed",
            Status.WARN,
            f"{len(offenders)} files > 5 MB, largest {worst[0]} ({worst[1] // 1_000_000} MB); affected: {locations}",
        )
    return CheckResult("large-files", "No oversized files committed", Status.PASS, "none over 5 MB")


@check("secrets", "No hardcoded secrets")
def secrets(repo: Repo) -> CheckResult:
    findings: list[str] = []
    for path in repo.text_files:
        for line_number, line in enumerate(repo.read_text(path).splitlines(), start=1):
            for label, pattern in SECRET_PATTERNS:
                match = pattern.search(line)
                if not match:
                    continue
                value = match.group(1) if match.groups() else match.group(0)
                if PLACEHOLDER_PATTERN.search(value):
                    continue
                findings.append(f"{path.as_posix()}:{line_number} ({label})")
                break

    if findings:
        return CheckResult(
            "secrets",
            "No hardcoded secrets",
            Status.FAIL,
            f"{len(findings)} suspected secrets; locations: {'; '.join(findings)}",
        )
    return CheckResult("secrets", "No hardcoded secrets", Status.PASS, "no credential-like literals found")
