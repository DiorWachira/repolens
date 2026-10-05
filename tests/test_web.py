from __future__ import annotations

import unittest
import json
import threading
from http.server import ThreadingHTTPServer
from urllib.error import HTTPError
from urllib.request import Request, urlopen
from unittest import mock

from repolens import web
from repolens.web import github_repo_url


class TestGithubUrls(unittest.TestCase):
    def test_parses_repository_url_and_git_suffix(self) -> None:
        self.assertEqual(github_repo_url("https://github.com/DiorWachira/repolens.git"), ("DiorWachira", "repolens"))

    def test_rejects_non_github_url(self) -> None:
        with self.assertRaises(ValueError):
            github_repo_url("https://gitlab.com/example/project")

    def test_rejects_repository_url_with_extra_path(self) -> None:
        with self.assertRaises(ValueError):
            github_repo_url("https://github.com/example/project/issues")


class TestAdvisorJobs(unittest.TestCase):
    def setUp(self):
        self.report = {"root": "demo", "score": 100, "checks": []}
        self.job_id = "test-job"
        web.AI_JOBS[self.job_id] = {"state": "running"}
        self.addCleanup(web.AI_JOBS.clear)

    def test_question_reaches_model(self):
        with mock.patch("repolens.web.ai.generate_insights", return_value={"summary": "ok"}) as generate:
            web.run_ai_job(self.job_id, self.report, "What next?", [])
        self.assertEqual(generate.call_args.kwargs, {"question": "What next?", "history": []})
        self.assertEqual(web.AI_JOBS[self.job_id]["state"], "complete")

    def test_provider_failure_is_reported(self):
        with mock.patch("repolens.web.ai.generate_insights", side_effect=RuntimeError("Quota reached")):
            web.run_ai_job(self.job_id, self.report)
        self.assertEqual(web.AI_JOBS[self.job_id]["error"], "Quota reached")

    def test_deadline_cannot_be_overwritten_by_late_success(self):
        with mock.patch("repolens.web.threading.Timer") as timer, mock.patch("repolens.web.ai.generate_insights", return_value={}):
            timer.return_value.start.side_effect = lambda: timer.call_args.args[1]()
            web.run_ai_job(self.job_id, self.report)
        self.assertEqual(web.AI_JOBS[self.job_id]["state"], "error")
        self.assertIn("timed out", web.AI_JOBS[self.job_id]["error"])
        timer.return_value.cancel.assert_called_once()

    def test_invalid_report_never_starts_thread(self):
        with mock.patch("repolens.web.threading.Thread") as thread:
            with self.assertRaises(ValueError):
                web.create_ai_job({"checks": "invalid"})
        thread.assert_not_called()

    def test_missing_key_never_starts_thread(self):
        with mock.patch("repolens.web.ai.api_key", side_effect=ValueError("Missing key")), mock.patch("repolens.web.threading.Thread") as thread:
            with self.assertRaisesRegex(ValueError, "Missing key"):
                web.create_ai_job(self.report)
        thread.assert_not_called()


class TestAdvisorHttp(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = ThreadingHTTPServer(("127.0.0.1", 0), web.ReportHandler)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.url = f"http://127.0.0.1:{cls.server.server_port}"

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join()

    def test_status_never_exposes_key(self):
        with mock.patch("repolens.web.ai.api_key", return_value="private-value"):
            with urlopen(self.url + "/api/ai/status", timeout=5) as response:
                payload = response.read().decode()
        self.assertTrue(json.loads(payload)["configured"])
        self.assertNotIn("private-value", payload)

    def test_post_passes_question_and_history(self):
        payload = {"report": {"root": "demo", "score": 100, "checks": []}, "question": "Why?", "history": []}
        with mock.patch("repolens.web.create_ai_job", return_value="job") as create:
            request = Request(self.url + "/api/insights", data=json.dumps(payload).encode(), headers={"Content-Type": "application/json"})
            with urlopen(request, timeout=5) as response:
                self.assertEqual(response.status, 202)
        create.assert_called_once_with(payload["report"], "Why?", [])

    def test_malformed_bodies_are_rejected(self):
        for body in (b"[]", b"null", b"broken", b"\xff"):
            with self.subTest(body=body), self.assertRaises(HTTPError) as caught:
                urlopen(Request(self.url + "/api/insights", data=body), timeout=5)
            self.assertEqual(caught.exception.code, 400)
            caught.exception.close()

    def test_large_bodies_are_rejected(self):
        with self.assertRaises(HTTPError) as caught:
            urlopen(Request(self.url + "/api/insights", data=b"x" * (web.MAX_REQUEST_BYTES + 1)), timeout=5)
        self.assertEqual(caught.exception.code, 413)
        caught.exception.close()


if __name__ == "__main__":
    unittest.main()