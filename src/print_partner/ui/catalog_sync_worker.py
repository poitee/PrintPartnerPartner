"""Background West3D Ambrosia catalog sync."""

from __future__ import annotations

from PySide6.QtCore import QThread, Signal

from print_partner.core.ambrosia_catalog import sync_ambrosia_catalog


class CatalogSyncWorker(QThread):
    progress = Signal(int, int)  # done, total
    finished_ok = Signal(object)  # AmbrosiaCatalog
    error = Signal(str)

    def __init__(self, parent=None):
        super().__init__(parent)
        self._cancel = False

    def cancel(self) -> None:
        self._cancel = True

    def run(self) -> None:
        try:

            def on_progress(done: int, total: int) -> None:
                if not self._cancel:
                    self.progress.emit(done, total)

            catalog = sync_ambrosia_catalog(on_progress=on_progress)
            if self._cancel:
                return
            self.finished_ok.emit(catalog)
        except Exception as exc:
            if not self._cancel:
                self.error.emit(str(exc))
