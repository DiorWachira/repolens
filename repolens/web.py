"""Small standard-library web app for local and public GitHub reports."""

from __future__ import annotations

import argparse
import json
import tempfile
import threading
import time
import uuid
import zipfile
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse
from urllib.request import Request, urlopen

from repolens import ai, builtin_checks  # noqa: F401  (registers checks)
from repolens.checks import REGISTRY, CheckResult, score
from repolens.repo import Repo

MAX_ARCHIVE_BYTES = 50 * 1024 * 1024
DOWNLOAD_TIMEOUT_SECONDS = 60
JOB_TIMEOUT_SECONDS = 180
FRONTEND_DIR = Path(__file__).resolve().parent.parent / "frontend"
JOBS: dict[str, dict[str, object]] = {}
JOBS_LOCK = threading.Lock()
AI_JOBS: dict[str, dict[str, object]] = {}
AI_JOBS_LOCK = threading.Lock()
AI_JOB_TIMEOUT_SECONDS = 60


def github_repo_url(value: str) -> tuple[str, str]:
    """Return owner and repo for a public github.com repository URL."""
    parsed = urlparse(value.strip())
    if parsed.scheme not in {"http", "https"} or parsed.netloc.lower() != "github.com":
        raise ValueError("paste a public https://github.com/owner/repository URL")
    parts = [part for part in parsed.path.split("/") if part]
    if len(parts) != 2:
        raise ValueError("URL must look like https://github.com/owner/repository")
    owner, repository = parts
    if repository.endswith(".git"):
        repository = repository[:-4]
    if not owner or not repository or any(character in owner + repository for character in "\\\0"):
        raise ValueError("invalid GitHub repository URL")
    return owner, repository


def download_repository(url: str, destination: Path, update=None) -> tuple[str, str]:
    if update:
        update(8, "Validating GitHub URL")
    owner, repository = github_repo_url(url)
    archive_url = f"https://api.github.com/repos/{owner}/{repository}/zipball"
    request = Request(archive_url, headers={"User-Agent": "repolens/0.1"})
    with urlopen(request, timeout=DOWNLOAD_TIMEOUT_SECONDS) as response:
        content_length = int(response.headers.get("Content-Length", "0"))
        if content_length > MAX_ARCHIVE_BYTES:
            raise ValueError("repository archive is larger than 50 MB")
        archive = response.read(MAX_ARCHIVE_BYTES + 1)
    if update:
        update(28, "Archive downloaded")
    if len(archive) > MAX_ARCHIVE_BYTES:
        raise ValueError("repository archive is larger than 50 MB")

    archive_path = destination / "repository.zip"
    archive_path.write_bytes(archive)
    with zipfile.ZipFile(archive_path) as bundle:
        for member in bundle.infolist():
            target = (destination / member.filename).resolve()
            if destination.resolve() not in target.parents:
                raise ValueError("repository archive contains an unsafe path")
            bundle.extract(member, destination)
    if update:
        update(42, "Repository files extracted")

    roots = [path for path in destination.iterdir() if path.is_dir()]
    if len(roots) != 1:
        raise ValueError("repository archive has an unexpected layout")
    return owner, repository


def report_for_github_url(url: str, update=None) -> dict[str, object]:
    with tempfile.TemporaryDirectory(prefix="repolens-") as temporary:
        owner, repository = download_repository(url, Path(temporary), update)
        root = next(path for path in Path(temporary).iterdir() if path.is_dir())
        repo = Repo(root)
        if update:
            update(48, "Reading repository files")
        results: list[CheckResult] = []
        for index, check in enumerate(REGISTRY):
            if update:
                progress = 50 + round(index * 45 / len(REGISTRY))
                update(progress, f"Running {check.title}")
            results.append(check.run(repo))
        if update:
            update(98, "Finalizing report")
        checks = []
        for result in results:
            check = {"id": result.id, "title": result.title, "status": result.status.value, "detail": result.detail}
            if result.id == "secrets" and result.status.value == "fail":
                check["locations"] = result.detail.split("locations: ", 1)[-1].split("; ")
            elif result.id == "large-files" and result.status.value == "warn":
                check["locations"] = result.detail.split("affected: ", 1)[-1].split("; ")
            checks.append(check)
        return {"root": f"github.com/{owner}/{repository}", "score": score(results), "checks": checks}


def update_job(job_id: str, progress: int, message: str) -> None:
    with JOBS_LOCK:
        job = JOBS.get(job_id)
        if job:
            job.update({"progress": progress, "message": message})


def run_job(job_id: str, url: str) -> None:
    started = time.monotonic()

    def update(progress: int, message: str) -> None:
        if time.monotonic() - started > JOB_TIMEOUT_SECONDS:
            raise TimeoutError(f"analysis timed out after {JOB_TIMEOUT_SECONDS} seconds")
        update_job(job_id, progress, message)

    try:
        payload = report_for_github_url(url, update)
        with JOBS_LOCK:
            JOBS[job_id].update({"state": "complete", "progress": 100, "message": "Analysis complete", "report": payload})
    except Exception as error:
        with JOBS_LOCK:
            JOBS[job_id].update({"state": "error", "progress": 0, "message": str(error), "error": str(error)})


def create_job(url: str) -> str:
    github_repo_url(url)
    job_id = uuid.uuid4().hex
    with JOBS_LOCK:
        JOBS[job_id] = {"state": "running", "progress": 2, "message": "Starting analysis"}
    threading.Thread(target=run_job, args=(job_id, url), daemon=True).start()
    return job_id


def run_ai_job(job_id: str, report: dict) -> None:
    started = time.monotonic()

    def update(progress: int, message: str) -> None:
        if time.monotonic() - started > AI_JOB_TIMEOUT_SECONDS:
            raise TimeoutError(f"AI analysis timed out after {AI_JOB_TIMEOUT_SECONDS} seconds")
        with AI_JOBS_LOCK:
            job = AI_JOBS.get(job_id)
            if job:
                job.update({"progress": progress, "message": message})

    try:
        insights = ai.generate_insights(report, update)
        with AI_JOBS_LOCK:
            AI_JOBS[job_id].update({"state": "complete", "progress": 100, "message": "AI analysis complete", "insights": insights})
    except Exception as error:
        with AI_JOBS_LOCK:
            AI_JOBS[job_id].update({"state": "error", "progress": 0, "message": str(error), "error": str(error)})


def create_ai_job(report: dict) -> str:
    if not isinstance(report, dict) or "checks" not in report:
        raise ValueError("a valid report is required to generate AI insights")
    job_id = uuid.uuid4().hex
    with AI_JOBS_LOCK:
        AI_JOBS[job_id] = {"state": "running", "progress": 5, "message": "Starting AI analysis"}
    threading.Thread(target=run_ai_job, args=(job_id, report), daemon=True).start()
    return job_id


class ReportHandler(SimpleHTTPRequestHandler):
    """Serve the dashboard and one URL-driven report endpoint."""

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=FRONTEND_DIR, **kwargs)

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path.startswith("/api/insights/"):
            job_id = parsed.path.rsplit("/", 1)[-1]
            with AI_JOBS_LOCK:
                job = AI_JOBS.get(job_id)
            if not job:
                return self._send_json(HTTPStatus.NOT_FOUND, {"error": "AI analysis job not found"})
            return self._send_json(HTTPStatus.OK, job)
        if parsed.path.startswith("/api/report/"):
            job_id = parsed.path.rsplit("/", 1)[-1]
            with JOBS_LOCK:
                job = JOBS.get(job_id)
            if not job:
                return self._send_json(HTTPStatus.NOT_FOUND, {"error": "analysis job not found"})
            return self._send_json(HTTPStatus.OK, job)
        if parsed.path != "/api/report":
            return super().do_GET()
        values = parse_qs(parsed.query).get("url", [])
        try:
            if not values:
                raise ValueError("include a GitHub repository URL")
            payload = report_for_github_url(values[0])
            self._send_json(HTTPStatus.OK, payload)
        except (ValueError, OSError, zipfile.BadZipFile) as error:
            self._send_json(HTTPStatus.BAD_REQUEST, {"error": str(error)})

    def do_POST(self) -> None:
        path = urlparse(self.path).path
        length = int(self.headers.get("Content-Length", "0"))
        try:
            body = json.loads(self.rfile.read(length)) if length else {}
        except json.JSONDecodeError as error:
            return self._send_json(HTTPStatus.BAD_REQUEST, {"error": str(error)})

        if path == "/api/insights":
            try:
                job_id = create_ai_job(body.get("report"))
                return self._send_json(HTTPStatus.ACCEPTED, {"job_id": job_id})
            except ValueError as error:
                return self._send_json(HTTPStatus.BAD_REQUEST, {"error": str(error)})

        if path != "/api/report":
            return self._send_json(HTTPStatus.NOT_FOUND, {"error": "not found"})
        try:
            job_id = create_job(str(body.get("url", "")))
            self._send_json(HTTPStatus.ACCEPTED, {"job_id": job_id})
        except ValueError as error:
            self._send_json(HTTPStatus.BAD_REQUEST, {"error": str(error)})

    def _send_json(self, status: HTTPStatus, payload: dict[str, object]) -> None:
        encoded = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(encoded)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(encoded)


def main() -> None:
    parser = argparse.ArgumentParser(description="Serve the repolens browser dashboard.")
    parser.add_argument("--port", type=int, default=8000)
    args = parser.parse_args()
    server = ThreadingHTTPServer(("127.0.0.1", args.port), ReportHandler)
    print(f"repolens dashboard: http://localhost:{args.port}")
    try:
        server.serve_forever()
    finally:
        server.server_close()


if __name__ == "__main__":
    main()