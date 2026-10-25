"""Small standard-library web app for local and public GitHub reports."""

from __future__ import annotations

import argparse
import json
import os
import tempfile
import threading
import time
import uuid
import zipfile
from collections import Counter
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse
from urllib.error import HTTPError
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
AI_JOB_TIMEOUT_SECONDS = ai.AI_TIMEOUT_SECONDS
MAX_REQUEST_BYTES = 200_000
MAX_EXTRACTED_BYTES = 300 * 1024 * 1024
MAX_ARCHIVE_MEMBERS = 20_000
FINISHED_JOB_TTL_SECONDS = 15 * 60
RATE_WINDOW_SECONDS = 10 * 60


def _env_int(name: str, default: int) -> int:
    try:
        return max(0, int(os.environ.get(name, default)))
    except ValueError:
        return default


# Requests per client per window; 0 disables a limit. Protects the Gemini quota
# and the server's GitHub bandwidth when the dashboard is publicly deployed.
RATE_LIMITS = {
    "report": _env_int("REPOLENS_REPORTS_PER_WINDOW", 12),
    "insights": _env_int("REPOLENS_QUESTIONS_PER_WINDOW", 40),
}
TRUST_PROXY = os.environ.get("REPOLENS_TRUST_PROXY", "").strip().lower() in {"1", "true", "yes"}
RATE_HITS: dict[tuple[str, str], list[float]] = {}
RATE_LOCK = threading.Lock()


def allow_request(kind: str, client: str, now: float | None = None) -> bool:
    """Sliding-window limiter keyed by request kind and client address."""
    limit = RATE_LIMITS.get(kind, 0)
    if not limit:
        return True
    now = time.monotonic() if now is None else now
    with RATE_LOCK:
        for key in [key for key, hits in RATE_HITS.items() if not hits or hits[-1] < now - RATE_WINDOW_SECONDS]:
            del RATE_HITS[key]
        hits = [hit for hit in RATE_HITS.get((kind, client), []) if hit >= now - RATE_WINDOW_SECONDS]
        if len(hits) >= limit:
            RATE_HITS[(kind, client)] = hits
            return False
        hits.append(now)
        RATE_HITS[(kind, client)] = hits
        return True


def prune_jobs(jobs: dict[str, dict[str, object]], lock: threading.Lock, now: float | None = None) -> None:
    """Forget finished jobs after a while so a long-running server does not grow."""
    now = time.monotonic() if now is None else now
    with lock:
        for job_id in [job_id for job_id, job in jobs.items() if job.get("state") != "running" and now - job.get("finished", now) > FINISHED_JOB_TTL_SECONDS]:
            del jobs[job_id]


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
    # codeload serves the default branch directly and, unlike the REST API,
    # is not subject to the 60-requests-per-hour unauthenticated limit.
    archive_url = f"https://codeload.github.com/{owner}/{repository}/zip/HEAD"
    request = Request(archive_url, headers={"User-Agent": "repolens/0.2"})
    try:
        with urlopen(request, timeout=DOWNLOAD_TIMEOUT_SECONDS) as response:
            content_length = int(response.headers.get("Content-Length", "0") or 0)
            if content_length > MAX_ARCHIVE_BYTES:
                raise ValueError("repository archive is larger than 50 MB")
            archive = response.read(MAX_ARCHIVE_BYTES + 1)
    except HTTPError as error:
        error.close()
        if error.code == 404:
            raise ValueError(f"github.com/{owner}/{repository} was not found, is private, or has no commits") from error
        raise ValueError(f"GitHub returned HTTP {error.code} for the archive; try again shortly") from error
    if update:
        update(28, "Archive downloaded")
    if len(archive) > MAX_ARCHIVE_BYTES:
        raise ValueError("repository archive is larger than 50 MB")

    archive_path = destination / "repository.zip"
    archive_path.write_bytes(archive)
    with zipfile.ZipFile(archive_path) as bundle:
        members = bundle.infolist()
        if len(members) > MAX_ARCHIVE_MEMBERS:
            raise ValueError(f"repository archive has more than {MAX_ARCHIVE_MEMBERS:,} entries")
        if sum(member.file_size for member in members) > MAX_EXTRACTED_BYTES:
            raise ValueError("repository expands to more than 300 MB")
        for member in members:
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
        return {"root": f"github.com/{owner}/{repository}", "score": score(results), "checks": checks, "profile": repository_profile(repo)}


def repository_profile(repo: Repo) -> dict[str, object]:
    """Small, non-sensitive shape of the repository: size, file types, layout."""
    extensions = Counter(path.suffix.lower() or path.name for path in repo.files)
    top_level = sorted({path.parts[0] + ("/" if len(path.parts) > 1 else "") for path in repo.files})
    return {
        "files": len(repo.files),
        "languages": [{"ext": ext, "count": count} for ext, count in extensions.most_common(8)],
        "top_level": top_level[:30],
    }


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
            JOBS[job_id].update({"state": "complete", "progress": 100, "message": "Analysis complete", "report": payload, "finished": time.monotonic()})
    except Exception as error:
        with JOBS_LOCK:
            JOBS[job_id].update({"state": "error", "progress": 0, "message": str(error), "error": str(error), "finished": time.monotonic()})


def create_job(url: str) -> str:
    github_repo_url(url)
    prune_jobs(JOBS, JOBS_LOCK)
    job_id = uuid.uuid4().hex
    with JOBS_LOCK:
        JOBS[job_id] = {"state": "running", "progress": 2, "message": "Starting analysis"}
    threading.Thread(target=run_job, args=(job_id, url), daemon=True).start()
    return job_id


def run_ai_job(job_id: str, report: dict, question: str = "", history: list | None = None, focus: str | None = None) -> None:
    started = time.monotonic()

    def expire() -> None:
        with AI_JOBS_LOCK:
            job = AI_JOBS.get(job_id)
            if job and job["state"] == "running":
                job.update({"state": "error", "error": "AI analysis timed out. Please retry.", "message": "AI analysis timed out. Please retry.", "finished": time.monotonic()})

    timer = threading.Timer(AI_JOB_TIMEOUT_SECONDS, expire)
    timer.daemon = True
    timer.start()

    def update(progress: int, message: str) -> None:
        if time.monotonic() - started > AI_JOB_TIMEOUT_SECONDS:
            raise TimeoutError(f"AI analysis timed out after {AI_JOB_TIMEOUT_SECONDS} seconds")
        with AI_JOBS_LOCK:
            job = AI_JOBS.get(job_id)
            if job and job["state"] == "running":
                job.update({"progress": progress, "message": message})

    try:
        insights = ai.generate_insights(report, update, question=question, history=history, focus=focus)
        with AI_JOBS_LOCK:
            if AI_JOBS[job_id]["state"] == "running":
                AI_JOBS[job_id].update({"state": "complete", "progress": 100, "message": "AI analysis complete", "insights": insights, "finished": time.monotonic()})
    except Exception as error:
        with AI_JOBS_LOCK:
            if AI_JOBS[job_id]["state"] == "running":
                message = str(error) if isinstance(error, (ValueError, RuntimeError, TimeoutError)) else "AI analysis failed. Please retry."
                AI_JOBS[job_id].update({"state": "error", "progress": 0, "message": message, "error": message, "finished": time.monotonic()})
    finally:
        timer.cancel()


def create_ai_job(report: dict, question: str = "", history: list | None = None, focus: str | None = None) -> str:
    ai.validate_request(report, question, history, focus)
    ai.api_key()
    prune_jobs(AI_JOBS, AI_JOBS_LOCK)
    job_id = uuid.uuid4().hex
    with AI_JOBS_LOCK:
        AI_JOBS[job_id] = {"state": "running", "progress": 5, "message": "Starting AI analysis"}
    threading.Thread(target=run_ai_job, args=(job_id, report, question, history, focus), daemon=True).start()
    return job_id


class ReportHandler(SimpleHTTPRequestHandler):
    """Serve the dashboard and one URL-driven report endpoint."""

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=FRONTEND_DIR, **kwargs)

    def end_headers(self) -> None:
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "strict-origin-when-cross-origin")
        self.send_header("X-Frame-Options", "SAMEORIGIN")
        super().end_headers()

    def client_id(self) -> str:
        # Behind a proxy (Render, Fly, nginx) the first X-Forwarded-For hop is the client.
        if TRUST_PROXY:
            forwarded = self.headers.get("X-Forwarded-For", "").split(",")[0].strip()
            if forwarded:
                return forwarded
        return self.client_address[0]

    def log_message(self, format: str, *args) -> None:
        # Job polling would otherwise flood the log; keep everything else.
        if self.command == "GET" and self.path.startswith(("/api/report/", "/api/insights/")):
            return
        super().log_message(format, *args)

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path == "/healthz":
            return self._send_json(HTTPStatus.OK, {"ok": True})
        if parsed.path == "/api/ai/status":
            try:
                ai.api_key()
                return self._send_json(HTTPStatus.OK, {"configured": True, "message": "Gemini configured", "timeout_seconds": AI_JOB_TIMEOUT_SECONDS})
            except ValueError as error:
                return self._send_json(HTTPStatus.OK, {"configured": False, "message": str(error), "timeout_seconds": AI_JOB_TIMEOUT_SECONDS})
        if parsed.path in {"", "/"}:
            self.path = "/index.html"
            return super().do_GET()
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
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if length < 0 or length > MAX_REQUEST_BYTES:
                # Drain a bounded amount so the client sees the 413 instead of a reset.
                self.rfile.read(min(max(length, 0), 4 * MAX_REQUEST_BYTES))
                self.close_connection = True
                return self._send_json(HTTPStatus.REQUEST_ENTITY_TOO_LARGE, {"error": "Request body is too large."})
            body = json.loads(self.rfile.read(length)) if length else {}
            if not isinstance(body, dict):
                raise ValueError("Expected a JSON object.")
        except (ValueError, UnicodeDecodeError):
            return self._send_json(HTTPStatus.BAD_REQUEST, {"error": "Expected a valid JSON object."})

        if path in {"/api/insights", "/api/report"} and not allow_request("insights" if path == "/api/insights" else "report", self.client_id()):
            return self._send_json(HTTPStatus.TOO_MANY_REQUESTS, {"error": "Too many requests from this address. Wait a few minutes and try again."})

        if path == "/api/insights":
            try:
                job_id = create_ai_job(body.get("report"), body.get("question", ""), body.get("history"), body.get("focus"))
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

    def send_error(self, code, message=None, explain=None) -> None:
        """Serve the designed 404 page for missing frontend files; API errors stay JSON."""
        page = FRONTEND_DIR / "404.html"
        if code != HTTPStatus.NOT_FOUND or self.path.startswith("/api/") or not page.is_file():
            return super().send_error(code, message, explain)
        body = page.read_bytes()
        self.send_response(code)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

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
    parser.add_argument("--host", default=os.environ.get("HOST", "127.0.0.1"), help="interface to bind (use 0.0.0.0 in a container or PaaS)")
    parser.add_argument("--port", type=int, default=int(os.environ.get("PORT", "8000")), help="port to listen on (defaults to $PORT, then 8000)")
    args = parser.parse_args()
    server = ThreadingHTTPServer((args.host, args.port), ReportHandler)
    shown = "localhost" if args.host in {"127.0.0.1", "0.0.0.0"} else args.host
    print(f"repolens dashboard: http://{shown}:{args.port}", flush=True)
    try:
        server.serve_forever()
    finally:
        server.server_close()


if __name__ == "__main__":
    main()