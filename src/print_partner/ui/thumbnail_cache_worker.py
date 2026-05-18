"""Background thumbnail warming for a profile manifest."""

from __future__ import annotations

from pathlib import Path

from PySide6.QtCore import QThread, Signal

from print_partner.core.thumbnails import (
    generate_thumbnail_subprocess,
    global_thumbnail_path,
    is_thumbnail_fresh,
)


class ThumbnailCacheWorker(QThread):
    progress = Signal(int, int, str)  # done, total, filename
    finished_counts = Signal(int, int, int)  # generated, skipped, failed

    def __init__(
        self,
        items: list[tuple[Path, str, str | None]],
        parent=None,
    ):
        super().__init__(parent)
        self._items = items
        self._cancel = False

    def cancel(self) -> None:
        self._cancel = True

    def run(self) -> None:
        from print_partner.debug_trace import debug_log

        # region agent log
        debug_log(
            "thumbnail_cache_worker.run",
            "thread_run_start",
            {"item_count": len(self._items)},
            hypothesis_id="A",
        )
        # endregion
        generated = 0
        skipped = 0
        failed = 0
        total = len(self._items)
        for i, (stl_path, role, mesh_hex) in enumerate(self._items):
            if self._cancel:
                break
            out = global_thumbnail_path(stl_path, role, mesh_hex)
            if is_thumbnail_fresh(stl_path, out):
                skipped += 1
            elif generate_thumbnail_subprocess(stl_path, out, role, mesh_hex):
                generated += 1
            else:
                failed += 1
            self.progress.emit(i + 1, total, stl_path.name)
        # region agent log
        debug_log(
            "thumbnail_cache_worker.run",
            "thread_run_end",
            {"cancelled": self._cancel, "generated": generated, "total": total},
            hypothesis_id="A",
        )
        # endregion
        self.finished_counts.emit(generated, skipped, failed)
