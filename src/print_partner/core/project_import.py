"""Register projects from git sync or local folders."""

from __future__ import annotations

import shutil
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

from print_partner.core import git_sync
from print_partner.core.git_sync import SyncResult
from print_partner.core.import_rules import (
    expand_rules_to_files,
    normalize_relative_path,
)


@dataclass
class LocalImportResult:
    local_path: Path
    last_synced_at: datetime


def register_local_project_path(name: str, source_dir: Path) -> LocalImportResult:
    """Point project at a local folder without copying (user selects files to import)."""
    source = source_dir.resolve()
    if not source.is_dir():
        raise ValueError(f"Not a directory: {source}")
    return LocalImportResult(local_path=source, last_synced_at=datetime.now(timezone.utc))


def import_local_folder(name: str, source_dir: Path) -> LocalImportResult:
    """Copy a local directory into ~/.print-partner/repos/{name} (legacy full import)."""
    source = source_dir.resolve()
    if not source.is_file() and not source.is_dir():
        raise ValueError(f"Not a directory: {source}")
    dest = git_sync.repo_local_path(name)
    if dest.exists():
        shutil.rmtree(dest)
    shutil.copytree(source, dest)
    return LocalImportResult(local_path=dest, last_synced_at=datetime.now(timezone.utc))


def import_selected_files(
    name: str,
    source_dir: Path,
    relative_files: list[str],
) -> LocalImportResult:
    """Copy only selected STL files into ~/.print-partner/repos/{name}, preserving paths."""
    source = source_dir.resolve()
    if not source.is_dir():
        raise ValueError(f"Not a directory: {source}")
    dest = git_sync.repo_local_path(name)
    if dest.exists():
        shutil.rmtree(dest)
    dest.mkdir(parents=True, exist_ok=True)
    copied = 0
    for rel in relative_files:
        rel_norm = normalize_relative_path(rel)
        src_file = source / rel_norm
        if not src_file.is_file():
            continue
        out = dest / rel_norm
        out.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(src_file, out)
        copied += 1
    if copied == 0:
        raise ValueError("No STL files were copied. Check your selection.")
    return LocalImportResult(local_path=dest, last_synced_at=datetime.now(timezone.utc))


def copy_selected_into_managed_repo(
    managed_root: Path,
    source_dir: Path,
    relative_files: list[str],
) -> LocalImportResult:
    """Refresh managed repo with only selected files (clears dest first)."""
    return import_selected_files(
        managed_root.name,
        source_dir,
        relative_files,
    )


def sync_git_project(name: str, url: str, branch: str = "main") -> SyncResult:
    return git_sync.sync_repository(name, url, branch)


def materialize_local_selection(
    project_name: str,
    source_dir: Path,
    rules: list[str],
) -> Path:
    """Copy selected STLs from source_dir into managed repos path; return dest."""
    files = expand_rules_to_files(source_dir, rules)
    if not files:
        raise ValueError("No STL files match the current selection.")
    result = import_selected_files(project_name, source_dir, files)
    return result.local_path
