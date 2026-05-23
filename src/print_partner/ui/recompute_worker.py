"""Background profile recompute (scan layers, merge, save)."""

from __future__ import annotations

import logging

from PySide6.QtCore import QThread, Signal

from print_partner.core.profile_ops import recompute_profile
from print_partner.db.session import db_session

logger = logging.getLogger(__name__)


class RecomputeWorker(QThread):
    progress = Signal(str)
    finished_ok = Signal(dict)
    error = Signal(str)

    def __init__(self, profile_id: int, parent=None):
        super().__init__(parent)
        self._profile_id = profile_id
        self._cancel = False

    def cancel(self) -> None:
        self._cancel = True

    def run(self) -> None:
        try:
            self.progress.emit("Scanning layers and merging parts…")
            with db_session() as session:
                result = recompute_profile(
                    session,
                    self._profile_id,
                    cancel_check=lambda: self._cancel,
                )
            if self._cancel:
                return
            self.finished_ok.emit(result)
        except Exception as exc:
            if not self._cancel:
                logger.exception("Recompute failed for profile %s", self._profile_id)
                self.error.emit(str(exc))
