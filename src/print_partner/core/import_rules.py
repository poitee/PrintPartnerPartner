"""Project-level STL import rules (opt-in file/folder selection)."""

from __future__ import annotations

import json
from pathlib import Path


def normalize_relative_path(path: str) -> str:
    return path.replace("\\", "/").strip().lstrip("/")


def normalize_rule(rule: str) -> str:
    """Normalize a single import rule (file path or folder prefix with trailing /)."""
    r = normalize_relative_path(rule)
    if not r:
        return r
    if r.endswith("/"):
        return r
    # Treat as folder prefix if it has no .stl extension
    if r.lower().endswith(".stl"):
        return r
    return f"{r}/"


def parse_import_rules_json(raw: str | None) -> list[str] | None:
    """
    Parse Project.imported_paths column.
    Returns None for legacy (import all), else a list of rules (may be empty).
    """
    if raw is None:
        return None
    raw = raw.strip()
    if not raw:
        return []
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        return []
    if not isinstance(data, list):
        return []
    rules: list[str] = []
    for item in data:
        if isinstance(item, str) and item.strip():
            rules.append(normalize_rule(item))
    return rules


def serialize_import_rules(rules: list[str] | None) -> str | None:
    """Serialize rules for DB. None = legacy all; [] = opt-in none."""
    if rules is None:
        return None
    normalized = []
    seen: set[str] = set()
    for rule in rules:
        r = normalize_rule(rule)
        if r and r not in seen:
            seen.add(r)
            normalized.append(r)
    return json.dumps(normalized)


def path_matches_rules(relative_path: str, rules: list[str]) -> bool:
    """True if relative_path is included by any rule."""
    if not rules:
        return False
    norm = normalize_relative_path(relative_path)
    for rule in rules:
        if rule.endswith("/"):
            prefix = rule.rstrip("/")
            if norm == prefix or norm.startswith(prefix + "/"):
                return True
        elif norm == rule:
            return True
    return False


def list_stl_relative_paths(repo_root: Path) -> list[str]:
    """List all STL paths relative to repo_root (sorted)."""
    if not repo_root.is_dir():
        return []
    root = repo_root.resolve()
    paths: list[str] = []
    for stl in root.rglob("*.stl"):
        if stl.is_file():
            paths.append(normalize_relative_path(str(stl.relative_to(root))))
    return sorted(paths, key=str.lower)


def count_matching_stls(repo_root: Path, rules: list[str] | None) -> tuple[int, int]:
    """Return (matching, total) STL counts under repo_root."""
    all_paths = list_stl_relative_paths(repo_root)
    total = len(all_paths)
    if rules is None:
        return total, total
    matching = sum(1 for p in all_paths if path_matches_rules(p, rules))
    return matching, total


def rules_from_selected_files(selected_files: list[str]) -> list[str]:
    """
    Compress a list of selected file paths into minimal rules (files + folder prefixes).
    Caller may pass explicit file paths; we store files individually and folder prefixes
    when an entire directory is selected (handled by UI).
    """
    rules: list[str] = []
    seen: set[str] = set()
    for f in selected_files:
        r = normalize_rule(f) if f.endswith("/") else normalize_relative_path(f)
        if r and r not in seen:
            seen.add(r)
            rules.append(r)
    return rules


def import_rules_for_project(imported_paths_raw: str | None) -> list[str] | None:
    """Read rules from Project.imported_paths column."""
    return parse_import_rules_json(imported_paths_raw)


def expand_rules_to_files(repo_root: Path, rules: list[str]) -> list[str]:
    """Expand rules to explicit file paths under repo_root."""
    all_paths = list_stl_relative_paths(repo_root)
    return [p for p in all_paths if path_matches_rules(p, rules)]
