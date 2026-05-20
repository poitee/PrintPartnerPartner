"""Repository markdown documentation discovery."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from print_partner.core.repo_readme import README_NAMES, find_readme

SKIP_DIR_NAMES = frozenset({".git", "node_modules", "__pycache__", ".venv", ".cursor"})
MAX_SIBLING_DOCS = 12


@dataclass(frozen=True)
class DocRef:
    path: Path
    title: str
    relative_path: str


def _safe_relative(repo_root: Path, path: Path) -> str:
    try:
        return path.relative_to(repo_root).as_posix()
    except ValueError:
        return path.name


def markdown_files_in_directory(repo_root: Path, relative_dir: str = "") -> list[Path]:
    """List markdown files in a directory under repo_root (README first, then others)."""
    if not repo_root.is_dir():
        return []
    target = (repo_root / relative_dir).resolve()
    try:
        target.relative_to(repo_root.resolve())
    except ValueError:
        return []
    if not target.is_dir():
        return []

    readme: list[Path] = []
    for name in README_NAMES:
        candidate = target / name
        if candidate.is_file():
            readme.append(candidate)
            break

    others: list[Path] = []
    for path in sorted(target.glob("*.md")):
        if path in readme:
            continue
        if path.name.startswith("."):
            continue
        others.append(path)
        if len(others) + len(readme) >= MAX_SIBLING_DOCS:
            break
    return readme + others


def best_doc_for_relative_path(
    repo_root: Path, relative_path: str | None
) -> DocRef | None:
    """Walk up from relative_path's parent to repo root; first README wins."""
    if not repo_root.is_dir():
        return None
    rel = (relative_path or "").strip().strip("/")
    if rel:
        start = Path(rel)
        if start.suffix.lower() == ".md":
            start = start.parent
        elif start.suffix:
            start = start.parent
        dirs: list[Path] = [start]
        while start != Path("."):
            start = start.parent
            dirs.append(start)
    else:
        dirs = [Path(".")]

    seen: set[Path] = set()
    for directory in dirs:
        if directory in seen:
            continue
        seen.add(directory)
        rel_dir = "" if directory == Path(".") else directory.as_posix()
        for doc_path in markdown_files_in_directory(repo_root, rel_dir):
            rel_doc = _safe_relative(repo_root, doc_path)
            return DocRef(path=doc_path, title=doc_path.name, relative_path=rel_doc)
    return None


def load_markdown_html(path: Path) -> str:
    import markdown

    text = path.read_text(encoding="utf-8", errors="replace")
    return markdown.markdown(text, extensions=["tables", "fenced_code"])


def doc_breadcrumb(repo_root: Path, doc_ref: DocRef) -> str:
    repo_name = repo_root.name or str(repo_root)
    parent = Path(doc_ref.relative_path).parent
    if parent == Path("."):
        return f"{repo_name} / {doc_ref.title}"
    return f"{repo_name} / {parent.as_posix()} / {doc_ref.title}"
