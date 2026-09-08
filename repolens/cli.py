"""Command line entry point."""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from repolens import __version__, builtin_checks  # noqa: F401  (import registers checks)
from repolens.checks import REGISTRY, Status, run_checks
from repolens.repo import Repo
from repolens.report import render_json, render_text


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="repolens",
        description="Audit a repository and report on its health.",
    )
    parser.add_argument("path", nargs="?", default=".", help="repository to inspect (default: current directory)")
    parser.add_argument("--json", action="store_true", help="emit machine-readable JSON")
    parser.add_argument("--only", metavar="ID", nargs="+", help="run only the named checks")
    parser.add_argument("--list", action="store_true", help="list available checks and exit")
    parser.add_argument("--strict", action="store_true", help="exit 1 if any check warns or fails")
    parser.add_argument("--version", action="version", version=f"repolens {__version__}")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)

    if args.list:
        for c in REGISTRY:
            print(f"{c.id:<12} {c.title}")
        return 0

    try:
        repo = Repo(Path(args.path))
        results = run_checks(repo, args.only)
    except (NotADirectoryError, KeyError) as exc:
        print(f"repolens: {exc}", file=sys.stderr)
        return 2

    root = str(repo.root)
    print(render_json(results, root) if args.json else render_text(results, root))

    if any(r.status is Status.FAIL for r in results):
        return 1
    if args.strict and any(r.status is Status.WARN for r in results):
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
