"""Background remote update checks for git projects."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from PySide6.QtCore import QThread, Signal

from print_partner.core.git_sync import RemoteUpdateStatus, remote_update_status


@dataclass(frozen=True)
class RemoteCheckSpec:
    project_id: int
    local_path: Path
    url: str
    branch: str
    last_commit_sha: str | None


class RemoteCheckWorker(QThread):
    """Check one project at a time; caller queues specs sequentially."""

    result = Signal(int, str)  # project_id, status label for UI

    def __init__(self, spec: RemoteCheckSpec, parent=None):
        super().__init__(parent)
        self._spec = spec

    def run(self) -> None:
        status = remote_update_status(
            self._spec.local_path,
            self._spec.url,
            self._spec.branch,
            self._spec.last_commit_sha,
        )
        label = _status_label(status)
        self.result.emit(self._spec.project_id, label)


def _status_label(status: RemoteUpdateStatus) -> str:
    if status == "up_to_date":
        return "Up to date"
    if status == "updates_available":
        return "Updates available"
    return "Offline"