"""Background HTML and STL zip export."""

from __future__ import annotations

import logging
from dataclasses import dataclass
from pathlib import Path
from typing import Literal

from PySide6.QtCore import QThread, Signal

from print_partner.core.export_3mf import Export3mfOptions, export_profile_3mf
from print_partner.core.export_html import export_path_for_profile, export_profile_html
from print_partner.core.export_stl_zip import export_profile_stl_zips
from print_partner.core.merge import MergePart

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class HtmlExportResult:
    path: Path
    part_count: int
    thumb_count: int
    cancelled: bool


@dataclass(frozen=True)
class StlExportResult:
    root: Path
    zip_counts: dict[str, int]
    warnings: list[str]
    cancelled: bool


@dataclass(frozen=True)
class ThreeMfExportResult:
    path: Path
    paths: list[Path]
    object_count: int
    plate_count: int
    warnings: list[str]
    printer_summaries: list[str]
    cancelled: bool


class ExportWorker(QThread):
    progress = Signal(int, int, str)  # current, total, filename
    html_done = Signal(object)
    stl_done = Signal(object)
    three_mf_done = Signal(object)
    error = Signal(str)

    def __init__(
        self,
        *,
        kind: Literal["html", "stl", "3mf"],
        profile_name: str,
        order_number: str | None,
        merge_parts: list[MergePart],
        completed_by_key: dict[str, list[bool]],
        exports_dir: Path,
        profile_id: int | None = None,
        three_mf_options: Export3mfOptions | None = None,
        parent=None,
    ):
        super().__init__(parent)
        self._kind = kind
        self._profile_name = profile_name
        self._order_number = order_number
        self._merge_parts = merge_parts
        self._completed_by_key = completed_by_key
        self._exports_dir = exports_dir
        self._profile_id = profile_id
        self._three_mf_options = three_mf_options
        self._cancel = False

    def cancel(self) -> None:
        self._cancel = True

    def run(self) -> None:
        try:
            if self._kind == "html":
                self._run_html()
            elif self._kind == "stl":
                self._run_stl()
            else:
                self._run_3mf()
        except Exception as exc:
            if not self._cancel:
                logger.exception("Export failed (%s)", self._kind)
                self.error.emit(str(exc))

    def _on_progress(self, current: int, total: int, filename: str) -> None:
        if not self._cancel:
            self.progress.emit(current, total, filename)

    def _cancel_check(self) -> bool:
        return self._cancel

    def _run_html(self) -> None:
        if self._cancel:
            return
        out = export_path_for_profile(self._profile_name, self._exports_dir)
        out, part_count, thumb_count = export_profile_html(
            self._profile_name,
            self._merge_parts,
            out,
            on_progress=self._on_progress,
            cancel_check=self._cancel_check,
            order_number=self._order_number,
            profile_id=self._profile_id,
            completed_by_match_key=self._completed_by_key,
        )
        self.html_done.emit(
            HtmlExportResult(
                path=out,
                part_count=part_count,
                thumb_count=thumb_count,
                cancelled=self._cancel,
            )
        )

    def _run_stl(self) -> None:
        if self._cancel:
            return
        root, zip_counts, warnings = export_profile_stl_zips(
            self._profile_name,
            self._merge_parts,
            self._exports_dir,
            on_progress=self._on_progress,
            cancel_check=self._cancel_check,
        )
        self.stl_done.emit(
            StlExportResult(
                root=root,
                zip_counts=zip_counts,
                warnings=warnings,
                cancelled=self._cancel,
            )
        )

    def _run_3mf(self) -> None:
        if self._cancel:
            return
        if not self._three_mf_options:
            self.error.emit("3MF export requires printer configuration (Print tab).")
            return
        result = export_profile_3mf(
            self._profile_name,
            self._merge_parts,
            self._exports_dir,
            on_progress=self._on_progress,
            cancel_check=self._cancel_check,
            options=self._three_mf_options,
        )
        self.three_mf_done.emit(
            ThreeMfExportResult(
                path=result.primary_path,
                paths=result.paths,
                object_count=result.object_count,
                plate_count=result.plate_count,
                warnings=result.warnings,
                printer_summaries=result.printer_summaries,
                cancelled=self._cancel,
            )
        )
