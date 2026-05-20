"""Background thumbnail warming for a profile manifest."""

from __future__ import annotations

from pathlib import Path

from PySide6.QtCore import QThread, Signal

from print_partner.core.thumbnails import (
    THUMB_BATCH_SIZE,
    generate_thumbnails_batch_subprocess,
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
        generated = 0
        skipped = 0
        failed = 0
        total = len(self._items)
        pending: list[tuple[Path, Path, str, str | None]] = []
        done = 0

        def flush_batch() -> None:
            nonlocal generated, failed, done, pending
            if not pending or self._cancel:
                pending.clear()
                return
            results = generate_thumbnails_batch_subprocess(pending)
            for _stl, out, _role, _hex in pending:
                if results.get(out, False):
                    generated += 1
                else:
                    failed += 1
            done += len(pending)
            self.progress.emit(done, total, pending[-1][0].name)
            pending.clear()

        for stl_path, role, mesh_hex in self._items:
            if self._cancel:
                break
            out = global_thumbnail_path(stl_path, role, mesh_hex)
            if is_thumbnail_fresh(stl_path, out):
                skipped += 1
                done += 1
                if done % 10 == 0 or done == total:
                    self.progress.emit(done, total, stl_path.name)
            else:
                pending.append((stl_path, out, role, mesh_hex))
                if len(pending) >= THUMB_BATCH_SIZE:
                    flush_batch()
        flush_batch()
        self.finished_counts.emit(generated, skipped, failed)
