"""Small standard-library web app for local and public GitHub reports."""

from __future__ import annotations

import argparse
import json
import tempfile
import zipfile
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse
from urllib.request import Request, urlopen

from repolens import builtin_checks  # noqa: F401  (registers checks)
from repolens.checks import run_checks
from repolens.repo import Repo
from repolens.report import render_json

MAX_ARCHIVE_BYTES = 50 * 1024 * 1024
FRONTEND_DIR = Path(__file__).resolve().parent.parent / "frontend"


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


def download_repository(url: str, destination: Path) -> tuple[str, str]:
    owner, repository = github_repo_url(url)
    archive_url = f"https://api.github.com/repos/{owner}/{repository}/zipball"
    request = Request(archive_url, headers={"User-Agent": "repolens/0.1"})
    with urlopen(request, timeout=20) as response:
        content_length = int(response.headers.get("Content-Length", "0"))
        if content_length > MAX_ARCHIVE_BYTES:
            raise ValueError("repository archive is larger than 50 MB")
        archive = response.read(MAX_ARCHIVE_BYTES + 1)
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

    roots = [path for path in destination.iterdir() if path.is_dir()]
    if len(roots) != 1:
        raise ValueError("repository archive has an unexpected layout")
    return owner, repository


def report_for_github_url(url: str) -> dict[str, object]:
    with tempfile.TemporaryDirectory(prefix="repolens-") as temporary:
        owner, repository = download_repository(url, Path(temporary))
        root = next(Path(temporary).iterdir())
        results = run_checks(Repo(root))
        return json.loads(render_json(results, f"github.com/{owner}/{repository}"))


class ReportHandler(SimpleHTTPRequestHandler):
    """Serve the dashboard and one URL-driven report endpoint."""

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=FRONTEND_DIR, **kwargs)

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
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