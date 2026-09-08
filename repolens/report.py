"""Rendering of check results."""

from __future__ import annotations

import json

from repolens.checks import CheckResult, Status, score

SYMBOLS = {Status.PASS: "PASS", Status.WARN: "WARN", Status.FAIL: "FAIL"}


def render_text(results: list[CheckResult], root: str) -> str:
    if not results:
        return "No checks selected."

    id_width = max(len(r.id) for r in results)
    lines = [f"repolens report for {root}", ""]
    for r in results:
        lines.append(f"  {SYMBOLS[r.status]}  {r.id.ljust(id_width)}  {r.title} - {r.detail}")

    counts = {s: sum(1 for r in results if r.status is s) for s in Status}
    lines.append("")
    lines.append(
        f"Health {score(results)}/100  "
        f"({counts[Status.PASS]} pass, {counts[Status.WARN]} warn, {counts[Status.FAIL]} fail)"
    )
    return "\n".join(lines)


def render_json(results: list[CheckResult], root: str) -> str:
    payload = {
        "root": root,
        "score": score(results),
        "checks": [
            {"id": r.id, "title": r.title, "status": r.status.value, "detail": r.detail} for r in results
        ],
    }
    return json.dumps(payload, indent=2)
