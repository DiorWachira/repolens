from __future__ import annotations

import unittest
import json
import tempfile
import threading
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen
from unittest import mock

from repolens import web
from repolens.repo import Repo
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


class TestRepositoryProfile(unittest.TestCase):
    def test_profile_counts_types_and_lists_top_level(self):
        with tempfile.TemporaryDirectory() as root:
            (Path(root) / "src").mkdir()
            (Path(root) / "src" / "a.py").write_text("x")
            (Path(root) / "src" / "b.py").write_text("x")
            (Path(root) / "README.md").write_text("x")
            profile = web.repository_profile(Repo(Path(root)))
        self.assertEqual(profile["files"], 3)
        self.assertEqual(profile["languages"][0], {"ext": ".py", "count": 2})
        self.assertEqual(profile["top_level"], ["README.md", "src/"])


class TestAdvisorJobs(unittest.TestCase):
    def setUp(self):
        self.report = {"root": "demo", "score": 100, "checks": []}
        self.job_id = "test-job"
        web.AI_JOBS[self.job_id] = {"state": "running"}
        self.addCleanup(web.AI_JOBS.clear)

    def test_question_reaches_model(self):
        with mock.patch("repolens.web.ai.generate_insights", return_value={"summary": "ok"}) as generate:
            web.run_ai_job(self.job_id, self.report, "What next?", [])
        self.assertEqual(generate.call_args.kwargs, {"question": "What next?", "history": [], "focus": None})
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
        cls.server = web.DashboardServer(("127.0.0.1", 0), web.ReportHandler)
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
        payload = {"report": {"root": "demo", "score": 100, "checks": [{"id": "ci", "title": "CI", "status": "warn", "detail": "none"}]},
                   "question": "Why?", "history": [], "focus": "ci"}
        with mock.patch("repolens.web.create_ai_job", return_value="job") as create:
            request = Request(self.url + "/api/insights", data=json.dumps(payload).encode(), headers={"Content-Type": "application/json"})
            with urlopen(request, timeout=5) as response:
                self.assertEqual(response.status, 202)
        create.assert_called_once_with(payload["report"], "Why?", [], "ci")

    def test_malformed_bodies_are_rejected(self):
        for body in (b"[]", b"null", b"broken", b"\xff"):
            with self.subTest(body=body), self.assertRaises(HTTPError) as caught:
                urlopen(Request(self.url + "/api/insights", data=body), timeout=5)
            self.assertEqual(caught.exception.code, 400)
            caught.exception.close()

    def test_missing_page_serves_designed_404(self):
        with self.assertRaises(HTTPError) as caught:
            urlopen(self.url + "/no-such-page", timeout=5)
        self.assertEqual(caught.exception.code, 404)
        self.assertIn("out of focus", caught.exception.read().decode())
        caught.exception.close()

    def test_large_bodies_are_rejected(self):
        with self.assertRaises(HTTPError) as caught:
            urlopen(Request(self.url + "/api/insights", data=b"x" * (web.MAX_REQUEST_BYTES + 1)), timeout=5)
        self.assertEqual(caught.exception.code, 413)
        caught.exception.close()

    def test_server_accepts_a_burst_of_connections(self):
        from concurrent.futures import ThreadPoolExecutor
        self.assertGreaterEqual(web.DashboardServer.request_queue_size, 64)
        with ThreadPoolExecutor(max_workers=40) as pool:
            statuses = list(pool.map(lambda _: urlopen(self.url + "/healthz", timeout=10).status, range(120)))
        self.assertEqual(set(statuses), {200})

    def test_health_check_and_security_headers(self):
        with urlopen(self.url + "/healthz", timeout=5) as response:
            self.assertEqual(json.loads(response.read()), {"ok": True})
            self.assertEqual(response.headers["X-Content-Type-Options"], "nosniff")

    def test_rate_limited_posts_get_429(self):
        payload = json.dumps({"url": "https://github.com/a/b"}).encode()
        with mock.patch("repolens.web.allow_request", return_value=False), mock.patch("repolens.web.create_job") as create:
            with self.assertRaises(HTTPError) as caught:
                urlopen(Request(self.url + "/api/report", data=payload, headers={"Content-Type": "application/json"}), timeout=5)
        self.assertEqual(caught.exception.code, 429)
        caught.exception.close()
        create.assert_not_called()


class TestDeploymentGuards(unittest.TestCase):
    def setUp(self):
        self.addCleanup(web.RATE_HITS.clear)

    def test_rate_limit_is_per_client_and_slides(self):
        with mock.patch.dict(web.RATE_LIMITS, {"report": 2}):
            self.assertTrue(web.allow_request("report", "a", now=0))
            self.assertTrue(web.allow_request("report", "a", now=1))
            self.assertFalse(web.allow_request("report", "a", now=2))
            self.assertTrue(web.allow_request("report", "b", now=2))
            self.assertTrue(web.allow_request("report", "a", now=web.RATE_WINDOW_SECONDS + 1))

    def test_zero_disables_a_limit(self):
        with mock.patch.dict(web.RATE_LIMITS, {"report": 0}):
            self.assertTrue(all(web.allow_request("report", "a", now=0) for _ in range(100)))

    def test_finished_jobs_are_pruned_running_jobs_kept(self):
        jobs = {"old": {"state": "complete", "finished": 0}, "new": {"state": "error", "finished": 1000}, "busy": {"state": "running"}}
        web.prune_jobs(jobs, threading.Lock(), now=web.FINISHED_JOB_TTL_SECONDS + 10)
        self.assertEqual(set(jobs), {"new", "busy"})

    def archive(self, entries: dict[str, bytes]) -> bytes:
        import io
        import zipfile
        buffer = io.BytesIO()
        with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as bundle:
            for name, data in entries.items():
                bundle.writestr(name, data)
        return buffer.getvalue()

    def fake_download(self, body: bytes):
        response = mock.MagicMock()
        response.__enter__.return_value.headers = {"Content-Length": str(len(body))}
        response.__enter__.return_value.read.return_value = body
        return mock.patch("repolens.web.urlopen", return_value=response)

    def test_downloads_from_codeload_and_extracts(self):
        with tempfile.TemporaryDirectory() as root, self.fake_download(self.archive({"demo-HEAD/README.md": b"hi"})) as opened:
            self.assertEqual(web.download_repository("https://github.com/o/demo", Path(root)), ("o", "demo"))
            self.assertTrue((Path(root) / "demo-HEAD" / "README.md").is_file())
        self.assertEqual(opened.call_args.args[0].full_url, "https://codeload.github.com/o/demo/zip/HEAD")

    def test_zip_bombs_are_refused(self):
        bomb = self.archive({"demo-HEAD/zeros.bin": b"\0" * 2_000_000})
        with tempfile.TemporaryDirectory() as root, self.fake_download(bomb), mock.patch.object(web, "MAX_EXTRACTED_BYTES", 1_000_000):
            with self.assertRaisesRegex(ValueError, "expands to more than"):
                web.download_repository("https://github.com/o/demo", Path(root))

    def test_too_many_entries_are_refused(self):
        many = self.archive({f"demo-HEAD/{index}.txt": b"x" for index in range(5)})
        with tempfile.TemporaryDirectory() as root, self.fake_download(many), mock.patch.object(web, "MAX_ARCHIVE_MEMBERS", 3):
            with self.assertRaisesRegex(ValueError, "more than 3 entries"):
                web.download_repository("https://github.com/o/demo", Path(root))

    def test_missing_repository_has_a_clear_message(self):
        missing = HTTPError("url", 404, "Not Found", {}, mock.MagicMock(read=lambda: b""))
        with tempfile.TemporaryDirectory() as root, mock.patch("repolens.web.urlopen", side_effect=missing):
            with self.assertRaisesRegex(ValueError, "not found, is private"):
                web.download_repository("https://github.com/o/missing", Path(root))


if __name__ == "__main__":
    unittest.main()