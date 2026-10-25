from __future__ import annotations

import json
import unittest
from unittest import mock
from urllib.error import HTTPError

from repolens import ai


def gemini_payload(inner: dict) -> bytes:
    return json.dumps({"candidates": [{"content": {"parts": [{"text": json.dumps(inner)}]}}]}).encode("utf-8")


class FakeResponse:
    def __init__(self, inner: dict | None = None):
        self.body = gemini_payload(inner or {"answer": "ok"})

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False

    def read(self):
        return self.body


def http_error(code: int) -> HTTPError:
    return HTTPError("url", code, "error", {}, mock.MagicMock(read=lambda: b"{}"))


REPORT = {
    "root": "github.com/example/demo",
    "score": 80,
    "checks": [
        {"id": "secrets", "title": "No hardcoded secrets", "status": "fail",
         "detail": "1 suspected secret", "locations": ["app.py:3 (hardcoded credential)"]},
        {"id": "todos", "title": "Unresolved TODO markers", "status": "warn", "detail": "16 markers"},
    ],
    "profile": {"files": 42, "languages": [{"ext": ".py", "count": 30}], "top_level": ["app.py", "tests/"]},
}
EMPTY_REPORT = {"root": "x", "score": 100, "checks": []}


def sent_body(opened) -> dict:
    return json.loads(opened.call_args.args[0].data.decode())


class TestApiKey(unittest.TestCase):
    def test_missing_key_raises_clear_error(self) -> None:
        with mock.patch.dict("os.environ", {}, clear=True), mock.patch("repolens.ai.saved_api_key", return_value=""):
            with self.assertRaisesRegex(ValueError, "GEMINI_API_KEY"):
                ai.api_key()

    def test_present_key_is_returned(self) -> None:
        with mock.patch.dict("os.environ", {"GEMINI_API_KEY": " abc123 "}, clear=True):
            self.assertEqual(ai.api_key(), "abc123")

    def test_saved_key_fallback(self) -> None:
        with mock.patch.dict("os.environ", {}, clear=True), mock.patch("repolens.ai.saved_api_key", return_value="saved-key"):
            self.assertEqual(ai.api_key(), "saved-key")


class TestReportContext(unittest.TestCase):
    def test_context_includes_score_checks_locations_and_profile(self) -> None:
        context = ai.report_context(REPORT)
        for expected in ("example/demo", "80/100", "No hardcoded secrets", "app.py:3", "Files scanned: 42", ".py x30", "tests/"):
            self.assertIn(expected, context)


class TestConversation(unittest.TestCase):
    def test_history_becomes_alternating_turns_ending_with_question(self) -> None:
        history = [
            {"role": "bot", "text": "Welcome"},
            {"role": "user", "text": "Review the report"},
            {"role": "bot", "text": "Step 1: Rotate the key\nStep 2: Remove the literal"},
        ]
        contents = ai.build_contents(REPORT, "Explain step two", history)
        self.assertEqual([turn["role"] for turn in contents], ["user", "model", "user", "model", "user"])
        self.assertIn("Step 2: Remove the literal", contents[3]["parts"][0]["text"])
        self.assertIn("CURRENT QUESTION: Explain step two", contents[-1]["parts"][0]["text"])
        self.assertNotIn("Explain step two", json.dumps(contents[:-1]))

    def test_retried_question_is_not_sent_twice(self) -> None:
        contents = ai.build_contents(REPORT, "Why no tests?", [{"role": "user", "text": "Why no tests?"}])
        self.assertEqual(json.dumps(contents).count("Why no tests?"), 1)

    def test_focus_is_structured_context(self) -> None:
        contents = ai.build_contents(REPORT, "How do I fix this?", [], focus="todos")
        self.assertIn("looking at the `todos` check (warn: 16 markers)", contents[-1]["parts"][0]["text"])

    def test_unknown_focus_is_rejected(self) -> None:
        with self.assertRaises(ValueError):
            ai.validate_request(REPORT, "Why?", [], focus="nonexistent")

    def test_empty_question_asks_for_initial_review(self) -> None:
        self.assertIn("initial review", ai.build_contents(REPORT)[-1]["parts"][0]["text"])

    def test_follow_up_does_not_force_a_plan(self) -> None:
        self.assertEqual(ai.RESPONSE_SCHEMA["required"], ["answer"])
        self.assertIn("ONLY when the user asks for a plan", ai.SYSTEM_INSTRUCTION)
        self.assertIn("Do not restate the overall summary", ai.SYSTEM_INSTRUCTION)


class TestParseResponse(unittest.TestCase):
    def test_parses_full_payload(self) -> None:
        inner = {"answer": "Rotate the key first.", "recommendations": [{"text": "Rotate", "checks": ["secrets"]}],
                 "workflow": [{"title": "Rotate", "detail": "Revoke the token", "verify": "Old token returns 401"}],
                 "follow_ups": ["How do I purge history?", "", "What next?", "And then?", "Extra"]}
        result = ai.parse_response(json.loads(gemini_payload(inner)))
        self.assertEqual(result["answer"], "Rotate the key first.")
        self.assertEqual(result["recommendations"], [{"text": "Rotate", "checks": ["secrets"]}])
        self.assertEqual(result["workflow"][0]["verify"], "Old token returns 401")
        self.assertEqual(result["follow_ups"], ["How do I purge history?", "What next?", "And then?"])

    def test_answer_only_payload_gets_empty_lists(self) -> None:
        result = ai.parse_response(json.loads(gemini_payload({"answer": "Use git grep."})))
        self.assertEqual((result["recommendations"], result["workflow"], result["follow_ups"]), ([], [], []))

    def test_thought_parts_are_ignored(self) -> None:
        payload = {"candidates": [{"content": {"parts": [{"text": "thinking...", "thought": True}, {"text": json.dumps({"answer": "ok"})}]}}]}
        self.assertEqual(ai.parse_response(payload)["answer"], "ok")

    def test_missing_candidates_raises(self) -> None:
        with self.assertRaises(RuntimeError):
            ai.parse_response({})

    def test_invalid_json_raises(self) -> None:
        with self.assertRaises(RuntimeError):
            ai.parse_response({"candidates": [{"content": {"parts": [{"text": "not json"}]}}]})

    def test_invalid_response_types(self) -> None:
        for inner in ({"answer": []}, {"answer": "  "}, {"answer": "ok", "recommendations": "bad"},
                      {"answer": "ok", "recommendations": ["bare string"]}, {"answer": "ok", "workflow": [{}]}):
            with self.subTest(inner=inner), self.assertRaises(RuntimeError):
                ai.parse_response(json.loads(gemini_payload(inner)))


class TestGenerateInsights(unittest.TestCase):
    def setUp(self) -> None:
        environment = mock.patch.dict("os.environ", {"GEMINI_API_KEY": "test-key"}, clear=True)
        environment.start()
        self.addCleanup(environment.stop)
        sleeper = mock.patch("repolens.ai.time.sleep")
        sleeper.start()
        self.addCleanup(sleeper.stop)

    def test_calls_api_and_reports_model(self) -> None:
        with mock.patch("repolens.ai.urlopen", return_value=FakeResponse()) as opened:
            result = ai.generate_insights(EMPTY_REPORT)
        self.assertEqual(result["answer"], "ok")
        self.assertEqual(result["model"], ai.DEFAULT_MODEL)
        body = sent_body(opened)
        self.assertEqual(body["generationConfig"]["responseSchema"], ai.RESPONSE_SCHEMA)
        self.assertIn("untrusted data", body["systemInstruction"]["parts"][0]["text"])
        self.assertEqual(body["generationConfig"]["thinkingConfig"], {"thinkingLevel": "low"})

    def test_thinking_level_only_sent_to_gemini_3_models(self) -> None:
        self.assertNotIn("thinkingConfig", json.loads(ai.request_body("gemini-flash-lite-latest", []))["generationConfig"])

    def test_requires_api_key(self) -> None:
        with mock.patch.dict("os.environ", {}, clear=True), mock.patch("repolens.ai.saved_api_key", return_value=""):
            with self.assertRaises(ValueError):
                ai.generate_insights(EMPTY_REPORT)

    def test_retries_on_503_then_succeeds(self) -> None:
        with mock.patch("repolens.ai.urlopen", side_effect=[http_error(503), FakeResponse()]) as opened:
            result = ai.generate_insights(EMPTY_REPORT)
        self.assertEqual(result["model"], ai.DEFAULT_MODEL)
        self.assertEqual(opened.call_count, 2)

    def test_falls_back_to_next_model_when_busy_or_retired(self) -> None:
        with mock.patch("repolens.ai.urlopen", side_effect=[http_error(503), http_error(503), http_error(404), FakeResponse()]) as opened:
            result = ai.generate_insights(EMPTY_REPORT)
        urls = [call.args[0].full_url for call in opened.call_args_list]
        self.assertIn(ai.FALLBACK_MODELS[0], urls[2])
        self.assertIn(ai.FALLBACK_MODELS[1], urls[3])
        self.assertEqual(result["model"], ai.FALLBACK_MODELS[1])

    def test_timeout_moves_to_next_model(self) -> None:
        with mock.patch("repolens.ai.urlopen", side_effect=[TimeoutError(), FakeResponse()]):
            result = ai.generate_insights(EMPTY_REPORT)
        self.assertEqual(result["model"], ai.FALLBACK_MODELS[0])

    def test_auth_errors_stop_immediately(self) -> None:
        with mock.patch("repolens.ai.urlopen", side_effect=[http_error(401), FakeResponse()]) as opened:
            with self.assertRaisesRegex(RuntimeError, "Authentication failed"):
                ai.generate_insights(EMPTY_REPORT)
        self.assertEqual(opened.call_count, 1)

    def test_raises_after_exhausting_every_model(self) -> None:
        with mock.patch("repolens.ai.urlopen", side_effect=http_error(503)):
            with self.assertRaisesRegex(RuntimeError, "503"):
                ai.generate_insights(EMPTY_REPORT)

    def test_follow_up_sends_history_question_and_focus_as_turns(self) -> None:
        history = [{"role": "user", "text": "Review"}, {"role": "bot", "text": "Step 1: Rotate"}]
        with mock.patch("repolens.ai.urlopen", return_value=FakeResponse()) as opened:
            ai.generate_insights(REPORT, question="Explain step one", history=history, focus="secrets")
        contents = sent_body(opened)["contents"]
        self.assertEqual([turn["role"] for turn in contents], ["user", "model", "user", "model", "user"])
        self.assertIn("Explain step one", contents[-1]["parts"][0]["text"])
        self.assertIn("`secrets`", contents[-1]["parts"][0]["text"])


class TestAdvisorContract(unittest.TestCase):
    def test_model_chain_honours_override_and_dedupes(self) -> None:
        for configured, expected in (("", ai.DEFAULT_MODEL), ("   ", ai.DEFAULT_MODEL), ("gemini-custom", "gemini-custom")):
            with self.subTest(configured=configured), mock.patch.dict("os.environ", {"GEMINI_MODEL": configured}, clear=True):
                chain = ai.models()
            self.assertEqual(chain[0], expected)
            self.assertEqual(len(chain), len(set(chain)))

    def test_model_must_not_be_a_url(self) -> None:
        with mock.patch.dict("os.environ", {"GEMINI_MODEL": "https://evil.example/x"}, clear=True):
            with self.assertRaises(ValueError):
                ai.models()

    def test_invalid_requests(self) -> None:
        for report in (None, {}, {"checks": "bad"}, {"root": "x", "score": 50, "checks": [{}]},
                       {"root": "x", "score": 50, "checks": [], "profile": "bad"}):
            with self.subTest(report=report), self.assertRaises(ValueError):
                ai.validate_request(report)

    def test_key_in_header_not_url_or_body(self) -> None:
        with mock.patch("repolens.ai.api_key", return_value="private-value"), mock.patch("repolens.ai.urlopen", return_value=FakeResponse()) as opened:
            ai.generate_insights(EMPTY_REPORT, question="What next?")
        request = opened.call_args.args[0]
        self.assertNotIn("private-value", request.full_url)
        self.assertNotIn("private-value", request.data.decode())
        self.assertEqual(request.get_header("X-goog-api-key"), "private-value")

    def test_network_errors_do_not_leak_credentials(self) -> None:
        with mock.patch("repolens.ai.api_key", return_value="private-value"), mock.patch("repolens.ai.urlopen", side_effect=TimeoutError("private-value")):
            with self.assertRaisesRegex(RuntimeError, "Check your connection") as caught:
                ai.generate_insights(EMPTY_REPORT)
        self.assertNotIn("private-value", str(caught.exception))


if __name__ == "__main__":
    unittest.main()
