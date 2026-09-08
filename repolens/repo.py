"""Filesystem view of a repository, shared by every check."""

from __future__ import annotations

from functools import cached_property
from pathlib import Path

IGNORED_DIRS = frozenset(
    {
        ".git",
        ".hg",
        ".svn",
        ".venv",
        "venv",
        "env",
        "node_modules",
        "__pycache__",
        ".mypy_cache",
        ".pytest_cache",
        ".ruff_cache",
        ".tox",
        ".idea",
        ".gradle",
        "dist",
        "build",
        "target",
        "out",
        "bin",
        "obj",
    }
)

TEXT_SUFFIXES = frozenset(
    {
        ".py", ".js", ".jsx", ".ts", ".tsx", ".java", ".kt", ".go", ".rs",
        ".rb", ".php", ".cs", ".c", ".h", ".cpp", ".hpp", ".sh", ".ps1",
        ".sql", ".html", ".css", ".scss", ".vue", ".svelte", ".md", ".rst",
        ".txt", ".json", ".yml", ".yaml", ".toml", ".ini", ".cfg", ".env",
    }
)

MAX_TEXT_BYTES = 1_000_000


class Repo:
    """A repository on disk, with cached file listings."""

    def __init__(self, root: Path) -> None:
        self.root = Path(root).resolve()
        if not self.root.is_dir():
            raise NotADirectoryError(f"not a directory: {self.root}")

    @cached_property
    def files(self) -> list[Path]:
        """Every non-ignored file, as paths relative to the repo root."""
        found: list[Path] = []
        for path in sorted(self.root.rglob("*")):
            relative = path.relative_to(self.root)
            if any(part in IGNORED_DIRS for part in relative.parts):
                continue
            if path.is_file():
                found.append(relative)
        return found

    @cached_property
    def text_files(self) -> list[Path]:
        return [p for p in self.files if p.suffix.lower() in TEXT_SUFFIXES]

    def find_top_level(self, *stems: str) -> Path | None:
        """Find a root-level file by stem, ignoring case and extension.

        `find_top_level("readme")` matches README.md, readme.rst or README.
        """
        wanted = {stem.lower() for stem in stems}
        for path in self.files:
            if len(path.parts) == 1 and path.stem.lower() in wanted:
                return path
        return None

    def glob(self, pattern: str) -> list[Path]:
        return [p for p in self.files if p.match(pattern)]

    def read_text(self, path: Path) -> str:
        """Read a repo-relative text file, returning "" if it is unreadable."""
        absolute = self.root / path
        try:
            if absolute.stat().st_size > MAX_TEXT_BYTES:
                return ""
            return absolute.read_text(encoding="utf-8", errors="replace")
        except OSError:
            return ""

    def size_of(self, path: Path) -> int:
        try:
            return (self.root / path).stat().st_size
        except OSError:
            return 0
