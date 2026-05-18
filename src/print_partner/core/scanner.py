"""Walk repo directories and collect STL parts."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from print_partner.config import settings
from print_partner.core.parsers import ParsedPart, parse_stl_path


@dataclass
class ScannedPart:
    relative_path: str
    filename: str
    match_key: str
    part_slug: str
    role: str
    quantity: int
    absolute_path: Path


def normalize_match_key(relative_path: str) -> str:
    return relative_path.replace("\\", "/").lower().strip("/")


def safe_repo_path(repo_root: Path, relative_path: str) -> Path | None:
    """Resolve path only if it stays under repo_root (reject ..)."""
    try:
        root = repo_root.resolve()
        candidate = (root / relative_path).resolve()
        candidate.relative_to(root)
        return candidate
    except (ValueError, OSError):
        return None


def is_under_data_repos(path: Path) -> bool:
    try:
        path.resolve().relative_to(settings.repos_dir.resolve())
        return True
    except ValueError:
        return False


def scan_repo(repo_root: Path, source_layer: str = "base") -> list[ScannedPart]:
    if not repo_root.is_dir():
        return []
    root = repo_root.resolve()
    if not is_under_data_repos(root) and settings.repos_dir.exists():
        try:
            root.relative_to(settings.repos_dir.resolve())
        except ValueError:
            pass

    parts: list[ScannedPart] = []
    for stl in root.rglob("*.stl"):
        if not stl.is_file():
            continue
        rel = str(stl.relative_to(root)).replace("\\", "/")
        parsed: ParsedPart = parse_stl_path(rel)
        parts.append(
            ScannedPart(
                relative_path=rel,
                filename=parsed.filename,
                match_key=normalize_match_key(rel),
                part_slug=parsed.part_slug,
                role=parsed.role.value,
                quantity=parsed.quantity,
                absolute_path=stl,
            )
        )
    return sorted(parts, key=lambda p: p.match_key)
