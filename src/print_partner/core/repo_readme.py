"""Locate and read repository README files."""

from __future__ import annotations

from pathlib import Path

README_NAMES = ("README.md", "readme.md", "Readme.md")


def find_readme(repo_path: Path) -> Path | None:
    if not repo_path.is_dir():
        return None
    for name in README_NAMES:
        candidate = repo_path / name
        if candidate.is_file():
            return candidate
    return None


def read_readme_text(repo_path: Path) -> str | None:
    readme = find_readme(repo_path)
    if readme is None:
        return None
    return readme.read_text(encoding="utf-8", errors="replace")
