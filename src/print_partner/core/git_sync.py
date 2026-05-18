"""Clone and sync GitHub STL repositories."""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

from git import Repo
from git.exc import GitCommandError

from print_partner.config import settings


@dataclass
class SyncResult:
    local_path: Path
    commit_sha: str
    last_synced_at: datetime


def _sanitize_name(name: str) -> str:
    return re.sub(r"[^\w\-.]+", "_", name.strip())[:128] or "repo"


def repo_local_path(name: str) -> Path:
    return settings.repos_dir / _sanitize_name(name)


def sync_repository(name: str, url: str, branch: str = "main") -> SyncResult:
    settings.ensure_dirs()
    dest = repo_local_path(name)
    now = datetime.now(timezone.utc)

    if not dest.exists():
        repo = Repo.clone_from(url, dest, branch=branch, depth=1)
    else:
        repo = Repo(dest)
        origin = repo.remotes.origin
        origin.fetch()
        try:
            repo.git.checkout(branch)
        except GitCommandError:
            repo.git.checkout("-b", branch, f"origin/{branch}")
        origin.pull()

    sha = repo.head.commit.hexsha
    return SyncResult(local_path=dest, commit_sha=sha, last_synced_at=now)
