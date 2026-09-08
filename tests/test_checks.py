"""Tests for the built-in checks."""

from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from repolens import builtin_checks  # noqa: F401  (registers checks)
from repolens.checks import REGISTRY, Status, run_checks, score
from repolens.repo import Repo


class RepoFixture(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.root = Path(self._tmp.name)
        self.addCleanup(self._tmp.cleanup)

    def write(self, relative: str, content: str = "") -> Path:
        path = self.root / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content, encoding="utf-8")
        return path

    def result(self, check_id: str):
        return run_checks(Repo(self.root), [check_id])[0]


class TestReadme(RepoFixture):
    def test_missing_readme_fails(self) -> None:
        self.assertIs(self.result("readme").status, Status.FAIL)

    def test_short_readme_warns(self) -> None:
        self.write("README.md", "too short")
        self.assertIs(self.result("readme").status, Status.WARN)

    def test_substantial_readme_passes(self) -> None:
        self.write("README.md", "x" * 400)
        self.assertIs(self.result("readme").status, Status.PASS)


class TestLicenseAndGitignore(RepoFixture):
    def test_missing_license_warns(self) -> None:
        self.assertIs(self.result("license").status, Status.WARN)

    def test_license_any_extension_passes(self) -> None:
        self.write("LICENSE.txt", "MIT")
        self.assertIs(self.result("license").status, Status.PASS)

    def test_gitignore_counts_rules_ignoring_comments(self) -> None:
        self.write(".gitignore", "# comment\n\n__pycache__/\n*.log\n")
        result = self.result("gitignore")
        self.assertIs(result.status, Status.PASS)
        self.assertIn("2 rules", result.detail)


class TestTestsAndCi(RepoFixture):
    def test_no_tests_fails(self) -> None:
        self.write("app.py", "print('hi')")
        self.assertIs(self.result("tests").status, Status.FAIL)

    def test_test_file_passes(self) -> None:
        self.write("tests/test_app.py", "")
        self.assertIs(self.result("tests").status, Status.PASS)

    def test_ci_workflow_detected(self) -> None:
        self.write(".github/workflows/ci.yml", "on: push")
        self.assertIs(self.result("ci").status, Status.PASS)


class TestTodosAndLargeFiles(RepoFixture):
    def test_todo_markers_are_counted(self) -> None:
        self.write("app.py", "# TODO: one\n# FIXME: two\n")
        result = self.result("todos")
        self.assertIs(result.status, Status.PASS)
        self.assertIn("2 markers", result.detail)

    def test_many_todos_warn(self) -> None:
        self.write("app.py", "# TODO\n" * 20)
        self.assertIs(self.result("todos").status, Status.WARN)

    def test_small_repo_has_no_large_files(self) -> None:
        self.write("app.py", "x")
        self.assertIs(self.result("large-files").status, Status.PASS)


class TestSecrets(RepoFixture):
    @staticmethod
    def assignment(name: str, value: str) -> str:
        """Build `name = "value"` at runtime so this file never contains a literal secret."""
        quote = chr(34)
        return f"{name} = {quote}{value}{quote}"

    def test_clean_repo_passes(self) -> None:
        self.write("app.py", "import os\nkey = os.environ['API_KEY']\n")
        self.assertIs(self.result("secrets").status, Status.PASS)

    def test_hardcoded_credential_fails(self) -> None:
        self.write("config.py", self.assignment("DB_PASSWORD", "hunter2hunter2"))
        result = self.result("secrets")
        self.assertIs(result.status, Status.FAIL)
        self.assertIn("config.py:1", result.detail)

    def test_placeholder_value_is_ignored(self) -> None:
        self.write("config.py", self.assignment("API_KEY", "your-key-here"))
        self.assertIs(self.result("secrets").status, Status.PASS)

    def test_aws_access_key_is_detected(self) -> None:
        self.write("deploy.sh", "export AWS_ID=" + "AKIA" + "J3QRSTUV7WXYZ2BCD")
        self.assertIs(self.result("secrets").status, Status.FAIL)

    def test_private_key_block_is_detected(self) -> None:
        self.write("id_rsa.txt", "-----BEGIN " + "RSA PRIVATE KEY-----")
        self.assertIs(self.result("secrets").status, Status.FAIL)

    def test_ignored_directories_are_not_scanned(self) -> None:
        self.write("node_modules/pkg/config.js", self.assignment("token", "abcdef1234567890"))
        self.assertIs(self.result("secrets").status, Status.PASS)


class TestRepoWalking(RepoFixture):
    def test_ignored_directories_are_skipped(self) -> None:
        self.write("app.py", "")
        self.write("node_modules/pkg/index.js", "")
        self.write(".venv/lib/thing.py", "")
        names = {p.as_posix() for p in Repo(self.root).files}
        self.assertEqual(names, {"app.py"})


class TestRegistryAndScoring(RepoFixture):
    def test_check_ids_are_unique(self) -> None:
        ids = [c.id for c in REGISTRY]
        self.assertEqual(len(ids), len(set(ids)))

    def test_unknown_check_raises(self) -> None:
        with self.assertRaises(KeyError):
            run_checks(Repo(self.root), ["does-not-exist"])

    def test_score_is_a_percentage(self) -> None:
        results = run_checks(Repo(self.root))
        self.assertTrue(0 <= score(results) <= 100)


if __name__ == "__main__":
    unittest.main()
