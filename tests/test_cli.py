"""Tests for the CLI surface."""

from __future__ import annotations

import io
import json
import tempfile
import unittest
from contextlib import redirect_stdout, redirect_stderr
from pathlib import Path

from repolens.cli import main


class TestCli(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.root = Path(self._tmp.name)
        self.addCleanup(self._tmp.cleanup)

    def run_cli(self, *args: str) -> tuple[int, str]:
        buffer = io.StringIO()
        with redirect_stdout(buffer), redirect_stderr(buffer):
            code = main(list(args))
        return code, buffer.getvalue()

    def test_list_checks(self) -> None:
        code, out = self.run_cli("--list")
        self.assertEqual(code, 0)
        self.assertIn("readme", out)

    def test_json_output_is_valid(self) -> None:
        code, out = self.run_cli(str(self.root), "--json")
        payload = json.loads(out)
        self.assertEqual(code, 1)  # empty repo fails the readme check
        self.assertIn("score", payload)
        self.assertTrue(payload["checks"])

    def test_json_and_text_include_evidence(self) -> None:
        quote = chr(34)
        (self.root / "settings.py").write_text(f"password = {quote}hunter2hunter2{quote}\n", encoding="utf-8")
        _, out = self.run_cli(str(self.root), "--only", "secrets", "--json")
        check = json.loads(out)["checks"][0]
        self.assertEqual(check["detail"], "1 suspected secret")
        self.assertEqual(check["evidence"], ["settings.py:1 (hardcoded credential)"])
        _, text = self.run_cli(str(self.root), "--only", "secrets")
        self.assertIn("- settings.py:1 (hardcoded credential)", text)

    def test_missing_path_reports_error(self) -> None:
        code, out = self.run_cli(str(self.root / "nope"))
        self.assertEqual(code, 2)
        self.assertIn("not a directory", out)

    def test_strict_turns_warnings_into_failure(self) -> None:
        code, _ = self.run_cli(str(self.root), "--only", "license", "--strict")
        self.assertEqual(code, 1)

    def test_passing_check_exits_zero(self) -> None:
        (self.root / "README.md").write_text("x" * 400, encoding="utf-8")
        code, _ = self.run_cli(str(self.root), "--only", "readme")
        self.assertEqual(code, 0)


if __name__ == "__main__":
    unittest.main()
