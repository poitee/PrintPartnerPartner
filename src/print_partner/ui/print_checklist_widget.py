"""In-app checkoff checklist — layout mirrors HTML export (single page scroll)."""

from __future__ import annotations

from pathlib import Path

from PySide6.QtCore import Qt, Signal
from PySide6.QtGui import QFont, QPixmap
from PySide6.QtWidgets import (
    QCheckBox,
    QFrame,
    QHBoxLayout,
    QHeaderView,
    QLabel,
    QScrollArea,
    QTableWidget,
    QTableWidgetItem,
    QVBoxLayout,
    QWidget,
)

from print_partner.core.print_checklist import (
    ChecklistPartRow,
    filaments_used_from_rows,
    filter_print_checklist_rows,
    group_checklist_rows,
    progress_summary,
)

# Match HTML export thumb column sizing (max-height ~11rem).
_THUMB_MAX_WIDTH = 140
_THUMB_MAX_HEIGHT = 176
_THUMB_ROW_MIN_HEIGHT = 184


class PrintChecklistWidget(QWidget):
    printed_toggled = Signal(int, bool)
    part_selected = Signal(int)

    def __init__(self, parent=None):
        super().__init__(parent)
        self._rows: list[dict] = []
        self._refreshing = False

        root = QVBoxLayout(self)
        root.setContentsMargins(0, 0, 0, 0)

        self.summary = QLabel("")
        self.summary.setProperty("muted", True)
        self.summary.setWordWrap(True)
        root.addWidget(self.summary)

        self.scroll = QScrollArea()
        self.scroll.setWidgetResizable(True)
        self.scroll.setFrameShape(QFrame.Shape.NoFrame)
        self._document = QWidget()
        self._document_layout = QVBoxLayout(self._document)
        self._document_layout.setContentsMargins(8, 0, 8, 16)
        self._document_layout.setSpacing(4)
        self.scroll.setWidget(self._document)
        root.addWidget(self.scroll, 1)

    def load_rows(self, rows: list[dict]) -> None:
        self._rows = list(rows)
        self._rebuild()

    def refresh_rows(self, rows: list[dict]) -> None:
        self._rows = list(rows)
        self._rebuild()

    def _filtered_rows(self) -> list[dict]:
        return filter_print_checklist_rows(self._rows)

    def _clear_document(self) -> None:
        while self._document_layout.count():
            item = self._document_layout.takeAt(0)
            if item.widget():
                item.widget().deleteLater()

    def _rebuild(self) -> None:
        self._clear_document()
        filtered = self._filtered_rows()
        self.summary.setText(
            f"{progress_summary(self._rows)} · showing {len(filtered)} included for printing"
        )

        if not filtered:
            empty = QLabel(
                "No parts included for printing. Choose parts on Build, then review on Verify."
            )
            empty.setProperty("muted", True)
            empty.setWordWrap(True)
            self._document_layout.addWidget(empty)
            return

        part_count = len(filtered)
        count_lbl = QLabel(f"{part_count} part(s)")
        count_lbl.setProperty("muted", True)
        self._document_layout.addWidget(count_lbl)

        filaments = filaments_used_from_rows(self._rows)
        if filaments:
            self._document_layout.addWidget(self._filaments_block(filaments))

        repo_sections = group_checklist_rows(filtered)
        for repo in repo_sections:
            self._document_layout.addWidget(self._repo_heading(repo.label))
            meta = QLabel(f"{repo.part_count} part(s) in this repository")
            meta.setProperty("muted", True)
            self._document_layout.addWidget(meta)
            for folder in repo.folders:
                folder_label = folder.label if folder.label != "(root)" else "(root)"
                self._document_layout.addWidget(self._folder_heading(folder_label))
                self._document_layout.addWidget(self._make_table(folder.parts))

        self._document_layout.addStretch(1)

    def _filaments_block(self, filaments: list[dict]) -> QWidget:
        box = QFrame()
        box.setFrameShape(QFrame.Shape.StyledPanel)
        layout = QVBoxLayout(box)
        layout.setContentsMargins(12, 10, 12, 10)
        title = QLabel("Filaments in this build")
        title_font = QFont(title.font())
        title_font.setBold(True)
        title.setFont(title_font)
        layout.addWidget(title)
        for entry in filaments:
            row = QHBoxLayout()
            row.setContentsMargins(0, 0, 0, 0)
            hex_color = entry.get("hex")
            if hex_color:
                swatch = QLabel()
                swatch.setFixedSize(20, 20)
                swatch.setStyleSheet(
                    f"background: {hex_color}; border: 1px solid #888; border-radius: 3px;"
                )
                row.addWidget(swatch)
            row.addWidget(QLabel(str(entry["label"])))
            row.addStretch()
            line = QWidget()
            line.setLayout(row)
            layout.addWidget(line)
        return box

    @staticmethod
    def _repo_heading(text: str) -> QLabel:
        label = QLabel(text)
        font = QFont(label.font())
        font.setPointSize(font.pointSize() + 3)
        font.setBold(True)
        label.setFont(font)
        label.setContentsMargins(0, 16, 0, 4)
        return label

    @staticmethod
    def _folder_heading(text: str) -> QLabel:
        label = QLabel(text)
        font = QFont(label.font())
        font.setBold(True)
        label.setFont(font)
        label.setContentsMargins(16, 8, 0, 4)
        return label

    def _make_table(self, parts: list[ChecklistPartRow]) -> QTableWidget:
        table = QTableWidget(len(parts), 6)
        table.setHorizontalHeaderLabels(
            ["Filename", "Qty", "Printed", "Verified", "Thumb", "Notes"]
        )
        table.setSelectionBehavior(QTableWidget.SelectionBehavior.SelectRows)
        table.setSelectionMode(QTableWidget.SelectionMode.SingleSelection)
        table.verticalHeader().setVisible(False)
        table.setShowGrid(True)
        table.setEditTriggers(QTableWidget.EditTrigger.NoEditTriggers)
        table.setWordWrap(True)

        header = table.horizontalHeader()
        header.setSectionResizeMode(0, QHeaderView.ResizeMode.Stretch)
        header.setSectionResizeMode(1, QHeaderView.ResizeMode.Fixed)
        header.setSectionResizeMode(2, QHeaderView.ResizeMode.Fixed)
        header.setSectionResizeMode(3, QHeaderView.ResizeMode.Fixed)
        header.setSectionResizeMode(4, QHeaderView.ResizeMode.Fixed)
        header.setSectionResizeMode(5, QHeaderView.ResizeMode.Stretch)
        table.setColumnWidth(1, 48)
        table.setColumnWidth(2, 64)
        table.setColumnWidth(3, 64)
        table.setColumnWidth(4, 160)

        self._refreshing = True
        for i, part in enumerate(parts):
            name_item = QTableWidgetItem(part.filename)
            name_item.setData(Qt.ItemDataRole.UserRole, part.id)
            name_item.setToolTip(part.filename)
            table.setItem(i, 0, name_item)
            qty_item = QTableWidgetItem(str(part.quantity))
            qty_item.setTextAlignment(
                Qt.AlignmentFlag.AlignCenter | Qt.AlignmentFlag.AlignVCenter
            )
            table.setItem(i, 1, qty_item)
            table.setCellWidget(i, 2, self._printed_cell(part))
            table.setCellWidget(i, 3, self._verified_cell())
            table.setCellWidget(i, 4, self._thumb_cell(part))
            notes_item = QTableWidgetItem(part.notes or "")
            notes_item.setToolTip(part.notes or "")
            table.setItem(i, 5, notes_item)
            table.setRowHeight(i, max(table.rowHeight(i), _THUMB_ROW_MIN_HEIGHT))
        self._refreshing = False

        table.itemSelectionChanged.connect(self._on_selection_changed)
        self._fit_table_height(table)
        return table

    def _thumb_cell(self, part: ChecklistPartRow) -> QWidget:
        wrap = QWidget()
        layout = QVBoxLayout(wrap)
        layout.setContentsMargins(4, 4, 4, 4)
        layout.setAlignment(Qt.AlignmentFlag.AlignCenter)
        label = QLabel()
        label.setAlignment(Qt.AlignmentFlag.AlignCenter)
        path = part.thumbnail_path
        if path and Path(path).is_file():
            pixmap = QPixmap(path)
            if not pixmap.isNull():
                scaled = pixmap.scaled(
                    _THUMB_MAX_WIDTH,
                    _THUMB_MAX_HEIGHT,
                    Qt.AspectRatioMode.KeepAspectRatio,
                    Qt.TransformationMode.SmoothTransformation,
                )
                label.setPixmap(scaled)
            else:
                label.setText("—")
                label.setProperty("muted", True)
        else:
            label.setText("—")
            label.setProperty("muted", True)
        layout.addWidget(label)
        return wrap

    @staticmethod
    def _fit_table_height(table: QTableWidget) -> None:
        """Show every row — no per-folder table scrollbar (like printed HTML)."""
        table.setVerticalScrollBarPolicy(Qt.ScrollBarPolicy.ScrollBarAlwaysOff)
        table.setHorizontalScrollBarPolicy(Qt.ScrollBarPolicy.ScrollBarAlwaysOff)
        table.resizeRowsToContents()
        header_h = table.horizontalHeader().height()
        frame = table.frameWidth() * 2
        rows_h = sum(table.rowHeight(r) for r in range(table.rowCount()))
        table.setFixedHeight(header_h + rows_h + frame)
        table.setSizePolicy(
            table.sizePolicy().horizontalPolicy(),
            table.sizePolicy().verticalPolicy(),
        )

    def _printed_cell(self, part: ChecklistPartRow) -> QWidget:
        container = QWidget()
        layout = QHBoxLayout(container)
        layout.setContentsMargins(6, 0, 6, 0)
        layout.setAlignment(Qt.AlignmentFlag.AlignCenter)
        cb = QCheckBox()
        cb.setToolTip("Mark all copies printed")
        cb.setChecked(part.all_printed)
        hex_color = part.filament_hex
        if hex_color:
            cb.setStyleSheet(f"QCheckBox::indicator:checked {{ background-color: {hex_color}; }}")
        pid = part.id

        def on_toggle(checked: bool) -> None:
            if self._refreshing:
                return
            self.printed_toggled.emit(pid, checked)

        cb.toggled.connect(on_toggle)
        layout.addWidget(cb)
        return container

    @staticmethod
    def _verified_cell() -> QWidget:
        container = QWidget()
        layout = QHBoxLayout(container)
        layout.setContentsMargins(6, 0, 6, 0)
        layout.setAlignment(Qt.AlignmentFlag.AlignCenter)
        cb = QCheckBox()
        cb.setToolTip("Customer verified (for printed checklist only)")
        cb.setEnabled(False)
        layout.addWidget(cb)
        return container

    def _on_selection_changed(self) -> None:
        table = self.sender()
        if not isinstance(table, QTableWidget):
            return
        rows = table.selectionModel().selectedRows()
        if not rows:
            return
        item = table.item(rows[0].row(), 0)
        if item:
            pid = item.data(Qt.ItemDataRole.UserRole)
            if pid is not None:
                self.part_selected.emit(int(pid))
