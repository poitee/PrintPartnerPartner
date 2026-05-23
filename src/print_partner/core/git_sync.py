"""Clone and sync GitHub STL repositories."""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Literal

from git import Repo
from git.exc import GitCommandError

from print_partner.config import settings

RemoteUpdateStatus = Literal["up_to_date", "updates_available", "unknown"]


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


def remote_update_status(
    local_path: Path,
    url: str,
    branch: str,
    last_sha: str | None,
) -> RemoteUpdateStatus:
    """Compare remote branch tip to last synced SHA without pulling."""
    if not local_path.is_dir() or url.startswith("file://"):
        return "unknown"
    try:
        repo = Repo(local_path)
        out = repo.git.ls_remote("origin", branch).strip()
        if not out:
            return "unknown"
        remote_sha = out.split()[0]
        compare = (last_sha or repo.head.commit.hexsha).strip()
        if remote_sha == compare:
            return "up_to_date"
        return "updates_available"
    except Exception:
        return "unknown"


def short_commit_sha(sha: str | None) -> str:
    if not sha:
        return "—"
    return sha[:7] if len(sha) >= 7 else sha
