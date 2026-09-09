"""AI-guided analysis, recommendations, and remediation workflow generation.

Uses the Google Gemini API (free tier via Google AI Studio). No API key is
bundled with the project - set GEMINI_API_KEY in the environment to enable
this feature. Without a key, callers get a clear ValueError.
"""

from __future__ import annotations

import json
import os
import time
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

DEFAULT_MODEL = "gemini-flash-latest"
API_TIMEOUT_SECONDS = 45
MAX_LOCATIONS_PER_CHECK = 6
RETRYABLE_STATUS_CODES = {429, 500, 503}
RETRYABLE_ATTEMPTS = 3
RETRY_DELAY_SECONDS = 2

RESPONSE_SCHEMA = {
    "type": "object",
    "properties": {
        "summary": {"type": "string"},
        "recommendations": {"type": "array", "items": {"type": "string"}},
        "workflow": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "title": {"type": "string"},
                    "detail": {"type": "string"},
                },
                "required": ["title", "detail"],
            },
        },
    },
    "required": ["summary", "recommendations", "workflow"],
}


def api_key() -> str:
    key = os.environ.get("GEMINI_API_KEY", "").strip()
    if not key:
        raise ValueError(
            "AI insights need a free Gemini API key. Set the GEMINI_API_KEY "
            "environment variable, then restart the server."
        )
    return key


def build_prompt(report: dict) -> str:
    """Summarize a repolens report into a prompt asking for guided analysis."""
    lines = [
        f"Repository: {report.get('root', 'unknown')}",
        f"Health score: {report.get('score', 0)}/100",
        "",
        "Checks:",
    ]
    for check in report.get("checks", []):
        lines.append(f"- [{check['status'].upper()}] {check['title']}: {check['detail']}")
        for location in check.get("locations", [])[:MAX_LOCATIONS_PER_CHECK]:
            lines.append(f"    location: {location}")

    lines += [
        "",
        "You are a senior software engineer reviewing this repository health report.",
        "Write a short plain-language summary of the repository's overall condition,",
        "then give concrete, prioritized recommendations for every warning or failure,",
        "then propose an ordered, dedicated remediation workflow (each step is a small,",
        "actionable unit of work, in the order an engineer should perform them).",
        "Only respond with the fields described in the schema.",
    ]
    return "\n".join(lines)


def parse_response(payload: dict) -> dict:
    try:
        text = payload["candidates"][0]["content"]["parts"][0]["text"]
    except (KeyError, IndexError, TypeError) as error:
        raise RuntimeError("the AI response did not contain any content") from error

    try:
        parsed = json.loads(text)
    except json.JSONDecodeError as error:
        raise RuntimeError("the AI response was not valid JSON") from error

    if not isinstance(parsed, dict) or "summary" not in parsed:
        raise RuntimeError("the AI response was missing required fields")
    parsed.setdefault("recommendations", [])
    parsed.setdefault("workflow", [])
    return parsed


def generate_insights(report: dict, update=None) -> dict:
    """Call the Gemini API and return a summary, recommendations, and a workflow."""
    key = api_key()
    model = os.environ.get("GEMINI_MODEL", DEFAULT_MODEL)
    if update:
        update(20, "Preparing repository summary for the AI model")

    prompt = build_prompt(report)
    request_body = json.dumps({
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": {
            "responseMimeType": "application/json",
            "responseSchema": RESPONSE_SCHEMA,
        },
    }).encode("utf-8")

    url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={key}"
    request = Request(url, data=request_body, headers={"Content-Type": "application/json"}, method="POST")

    if update:
        update(45, "Waiting for the AI model to respond")

    payload = None
    last_error: Exception | None = None
    for attempt in range(RETRYABLE_ATTEMPTS):
        try:
            with urlopen(request, timeout=API_TIMEOUT_SECONDS) as response:
                payload = json.loads(response.read().decode("utf-8"))
            break
        except HTTPError as error:
            detail = error.read().decode("utf-8", errors="replace")[:300]
            last_error = RuntimeError(f"Gemini API error {error.code}: {detail}")
            if error.code not in RETRYABLE_STATUS_CODES or attempt == RETRYABLE_ATTEMPTS - 1:
                raise last_error from error
            if update:
                update(45, f"Model is busy, retrying ({attempt + 1}/{RETRYABLE_ATTEMPTS - 1})...")
            time.sleep(RETRY_DELAY_SECONDS * (attempt + 1))
        except URLError as error:
            raise RuntimeError(f"could not reach the Gemini API: {error.reason}") from error

    if update:
        update(85, "Formatting recommendations")
    return parse_response(payload)
