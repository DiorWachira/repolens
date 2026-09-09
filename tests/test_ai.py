from __future__ import annotations

import json
import unittest
from unittest import mock

from repolens import ai


class TestApiKey(unittest.TestCase):
    def test_missing_key_raises_clear_error(self) -> None:
        with mock.patch.dict("os.environ", {}, clear=True):
            with self.assertRaisesRegex(ValueError, "GEMINI_API_KEY"):
                ai.api_key()

    def test_present_key_is_returned(self) -> None:
        with mock.patch.dict("os.environ", {"GEMINI_API_KEY": " abc123 "}, clear=True):
            self.assertEqual(ai.api_key(), "abc123")


class TestBuildPrompt(unittest.TestCase):
    def test_prompt_includes_score_and_check_details(self) -> None:
        report = {
            "root": "github.com/example/demo",
            "score": 80,
            "checks": [
                {"id": "secrets", "title": "No hardcoded secrets", "status": "fail",
                 "detail": "1 suspected secret", "locations": ["app.py:3 (hardcoded credential)"]},
            ],
        }
        prompt = ai.build_prompt(report)
        self.assertIn("example/demo", prompt)
        self.assertIn("80/100", prompt)
        self.assertIn("No hardcoded secrets", prompt)
        self.assertIn("app.py:3", prompt)


class TestParseResponse(unittest.TestCase):
    def test_parses_valid_gemini_payload(self) -> None:
        inner = {"summary": "Looks healthy.", "recommendations": ["Add tests"], "workflow": [{"title": "Add tests", "detail": "Write unit tests"}]}
        payload = {"candidates": [{"content": {"parts": [{"text": json.dumps(inner)}]}}]}
        result = ai.parse_response(payload)
        self.assertEqual(result["summary"], "Looks healthy.")
        self.assertEqual(result["recommendations"], ["Add tests"])

    def test_missing_candidates_raises(self) -> None:
        with self.assertRaises(RuntimeError):
            ai.parse_response({})

    def test_invalid_json_raises(self) -> None:
        payload = {"candidates": [{"content": {"parts": [{"text": "not json"}]}}]}
        with self.assertRaises(RuntimeError):
            ai.parse_response(payload)


class TestGenerateInsights(unittest.TestCase):
    def test_generate_insights_calls_api_and_parses_result(self) -> None:
        inner = {"summary": "ok", "recommendations": [], "workflow": []}
        response_body = json.dumps({"candidates": [{"content": {"parts": [{"text": json.dumps(inner)}]}}]}).encode("utf-8")

        class FakeResponse:
            def __enter__(self):
                return self

            def __exit__(self, *args):
                return False

            def read(self):
                return response_body

        with mock.patch.dict("os.environ", {"GEMINI_API_KEY": "test-key"}, clear=True):
            with mock.patch("repolens.ai.urlopen", return_value=FakeResponse()):
                result = ai.generate_insights({"root": "x", "score": 100, "checks": []})
        self.assertEqual(result["summary"], "ok")

    def test_generate_insights_requires_api_key(self) -> None:
        with mock.patch.dict("os.environ", {}, clear=True):
            with self.assertRaises(ValueError):
                ai.generate_insights({"root": "x", "score": 100, "checks": []})

    def test_generate_insights_retries_on_503_then_succeeds(self) -> None:
        inner = {"summary": "ok", "recommendations": [], "workflow": []}
        response_body = json.dumps({"candidates": [{"content": {"parts": [{"text": json.dumps(inner)}]}}]}).encode("utf-8")

        class FakeResponse:
            def __enter__(self):
                return self

            def __exit__(self, *args):
                return False

            def read(self):
                return response_body

        from urllib.error import HTTPError
        busy = HTTPError("url", 503, "busy", {}, mock.MagicMock(read=lambda: b'{"error": "busy"}'))

        with mock.patch.dict("os.environ", {"GEMINI_API_KEY": "test-key"}, clear=True):
            with mock.patch("repolens.ai.urlopen", side_effect=[busy, FakeResponse()]):
                with mock.patch("repolens.ai.time.sleep"):
                    result = ai.generate_insights({"root": "x", "score": 100, "checks": []})
        self.assertEqual(result["summary"], "ok")

    def test_generate_insights_raises_after_exhausting_retries(self) -> None:
        from urllib.error import HTTPError
        busy = HTTPError("url", 503, "busy", {}, mock.MagicMock(read=lambda: b'{"error": "busy"}'))
        with mock.patch.dict("os.environ", {"GEMINI_API_KEY": "test-key"}, clear=True):
            with mock.patch("repolens.ai.urlopen", side_effect=[busy, busy, busy]):
                with mock.patch("repolens.ai.time.sleep"):
                    with self.assertRaises(RuntimeError):
                        ai.generate_insights({"root": "x", "score": 100, "checks": []})


if __name__ == "__main__":
    unittest.main()
