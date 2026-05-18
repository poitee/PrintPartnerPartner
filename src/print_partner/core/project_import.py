"""Register projects from git sync or local folders."""

from __future__ import annotations

import shutil
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

from print_partner.core import git_sync
from print_partner.core.git_sync import SyncResult


@dataclass
class LocalImportResult:
    local_path: Path
    last_synced_at: datetime


def import_local_folder(name: str, source_dir: Path) -> LocalImportResult:
    """Copy a local directory into ~/.print-partner/repos/{name}."""
    source = source_dir.resolve()
    if not source.is_dir():
        raise ValueError(f"Not a directory: {source}")
    dest = git_sync.repo_local_path(name)
    if dest.exists():
        shutil.rmtree(dest)
    shutil.copytree(source, dest)
    return LocalImportResult(local_path=dest, last_synced_at=datetime.now(timezone.utc))


def sync_git_project(name: str, url: str, branch: str = "main") -> SyncResult:
    return git_sync.sync_repository(name, url, branch)
