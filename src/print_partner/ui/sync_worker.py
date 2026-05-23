"""Background git sync for all projects."""

from __future__ import annotations

import logging
from dataclasses import dataclass

from PySide6.QtCore import QThread, Signal

from print_partner.core import git_sync

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class SyncProjectSpec:
    project_id: int
    name: str
    url: str
    branch: str


class SyncAllWorker(QThread):
    progress = Signal(int, int, str)  # index 1-based, total, name
    project_done = Signal(int, object)  # project_id, SyncResult | Exception

    def __init__(self, projects: list[SyncProjectSpec], parent=None):
        super().__init__(parent)
        self._projects = projects
        self._cancel = False

    def cancel(self) -> None:
        self._cancel = True

    def run(self) -> None:
        total = len(self._projects)
        for i, spec in enumerate(self._projects):
            if self._cancel:
                break
            self.progress.emit(i + 1, total, spec.name)
            try:
                result = git_sync.sync_repository(spec.name, spec.url, spec.branch)
                self.project_done.emit(spec.project_id, result)
            except Exception as exc:
                logger.exception("Sync failed for project %s", spec.name)
                self.project_done.emit(spec.project_id, exc)
