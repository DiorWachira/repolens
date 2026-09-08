"""Check registry and result types.

A check is a function decorated with `@check(id, title)` that takes a `Repo`
and returns a `CheckResult`. Registration order is the report order.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum
from typing import Callable

from repolens.repo import Repo


class Status(Enum):
    PASS = "pass"
    WARN = "warn"
    FAIL = "fail"

    @property
    def score(self) -> float:
        return {"pass": 1.0, "warn": 0.5, "fail": 0.0}[self.value]


@dataclass(frozen=True)
class CheckResult:
    id: str
    title: str
    status: Status
    detail: str


@dataclass(frozen=True)
class Check:
    id: str
    title: str
    run: Callable[[Repo], CheckResult]


REGISTRY: list[Check] = []


def check(check_id: str, title: str) -> Callable[[Callable[..., object]], Callable[..., object]]:
    """Register a check function under a stable id."""
    if any(existing.id == check_id for existing in REGISTRY):
        raise ValueError(f"duplicate check id: {check_id}")

    def decorator(fn):
        REGISTRY.append(Check(check_id, title, fn))
        return fn

    return decorator


def run_checks(repo: Repo, only: list[str] | None = None) -> list[CheckResult]:
    selected = REGISTRY if not only else [c for c in REGISTRY if c.id in set(only)]
    if only:
        unknown = sorted(set(only) - {c.id for c in REGISTRY})
        if unknown:
            raise KeyError(f"unknown check(s): {', '.join(unknown)}")
    return [c.run(repo) for c in selected]


def score(results: list[CheckResult]) -> int:
    """Overall health as a percentage, 0-100."""
    if not results:
        return 0
    return round(100 * sum(r.status.score for r in results) / len(results))
