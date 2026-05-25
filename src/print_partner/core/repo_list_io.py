"""Export and import the repository list for sharing between machines."""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from print_partner.db.models import Project

REPO_LIST_FORMAT = "print-partner-repo-list"
REPO_LIST_VERSION = 1


def projects_to_export_list(session: Session) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for proj in session.scalars(select(Project).order_by(Project.name)).all():
        rows.append(
            {
                "name": proj.name,
                "url": proj.url,
                "branch": proj.branch or "main",
                "source_type": proj.source_type or "git",
                "local_path": proj.local_path,
                "docs_url": proj.docs_url,
            }
        )
    return rows


def export_repo_list_file(session: Session, dest: Path) -> Path:
    dest = Path(dest)
    dest.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "format": REPO_LIST_FORMAT,
        "version": REPO_LIST_VERSION,
        "exported_at": datetime.now(timezone.utc).isoformat(),
        "projects": projects_to_export_list(session),
    }
    dest.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")
    return dest


def import_repo_list_file(session: Session, path: Path) -> int:
    path = Path(path)
    data = json.loads(path.read_text(encoding="utf-8"))
    if data.get("format") not in (REPO_LIST_FORMAT, None):
        raise ValueError("Not a Print Partner repository list file")
    if int(data.get("version", 1)) != REPO_LIST_VERSION:
        raise ValueError(f"Unsupported list version (expected {REPO_LIST_VERSION})")
    projects = data.get("projects")
    if not isinstance(projects, list):
        raise ValueError("Missing projects array")
    count = 0
    for raw in projects:
        if not isinstance(raw, dict):
            continue
        name = (raw.get("name") or "").strip()
        url = (raw.get("url") or "").strip()
        if not name or not url:
            continue
        branch = (raw.get("branch") or "main").strip() or "main"
        source_type = (raw.get("source_type") or "git").strip() or "git"
        existing = session.scalars(select(Project).where(Project.name == name)).first()
        if existing:
            existing.url = url
            existing.branch = branch
            existing.source_type = source_type
            if raw.get("docs_url"):
                existing.docs_url = str(raw.get("docs_url") or "").strip() or None
            if source_type == "local" and raw.get("local_path"):
                existing.local_path = str(raw.get("local_path") or "").strip() or None
        else:
            session.add(
                Project(
                    name=name,
                    url=url,
                    branch=branch,
                    source_type=source_type,
                    local_path=(str(raw.get("local_path") or "").strip() or None)
                    if source_type == "local"
                    else None,
                    docs_url=(str(raw.get("docs_url") or "").strip() or None)
                    if raw.get("docs_url")
                    else None,
                )
            )
        count += 1
    return count
