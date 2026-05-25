"""In-app checkoff checklist — layout mirrors HTML export (single page scroll)."""

from __future__ import annotations

from pathlib import Path

from PySide6.QtCore import Qt, Signal
from PySide6.QtGui import QFont, QPalette, QPixmap
from PySide6.QtWidgets import (
    QCheckBox,
    QComboBox,
    QFrame,
    QHBoxLayout,
    QLabel,
    QScrollArea,
    QSpinBox,
    QTableWidget,
    QTableWidgetItem,
    QVBoxLayout,
    QWidget,
)

from print_partner.core.checkoff_missing import filter_checkoff_display_rows
from print_partner.core.print_checklist import (
    ChecklistPartRow,
    group_checklist_rows,
    progress_summary,
)
from print_partner.ui.table_layout import configure_table_columns

# Sized for letter paper when exported; compact in-app preview column.
_THUMB_MAX_WIDTH = 112
_THUMB_MAX_HEIGHT = 140
_THUMB_ROW_MIN_HEIGHT = 148
_CHECK_COL_WIDTH = 72


class PrintChecklistWidget(QWidget):
    printed_toggled = Signal(int, bool)
    printed_count_changed = Signal(int, int)  # part_id, completed unit count
    part_selected = Signal(int)
    filter_changed = Signal()

    def __init__(self, parent=None):
        super().__init__(parent)
        self.setObjectName("PrintChecklistWidget")
        self._rows: list[dict] = []
        self._kit_name = ""
        self._order_number: str | None = None
        self._refreshing = False
        self._filter_mode = "all"

        root = QVBoxLayout(self)
        root.setContentsMargins(0, 0, 0, 0)

        self._header_card = QFrame()
        self._header_card.setObjectName("checklistHeader")
        header_layout = QVBoxLayout(self._header_card)
        header_layout.setContentsMargins(8, 6, 8, 6)
        header_layout.setSpacing(2)
        self._header_kicker = QLabel("Print Partner · Build checklist")
        self._header_kicker.setObjectName("checklistKicker")
        self._header_title = QLabel("")
        self._header_title.setObjectName("checklistTitle")
        title_font = QFont(self._header_title.font())
        title_font.setPointSize(title_font.pointSize() + 2)
        title_font.setBold(True)
        self._header_title.setFont(title_font)
        self._header_meta = QLabel("")
        self._header_meta.setProperty("muted", True)
        self._header_meta.setWordWrap(True)
        self._header_help = QLabel(
            "Use the <b>Print</b> column to record finished units (saved automatically). "
            "Filter the list without losing progress. For exports, use the bar above: "
            "<b>Print missing →</b> (Print tab + 3MF), <b>Export missing 3MF…</b>, or "
            "<b>Export checklist</b> for HTML."
        )
        self._header_help.setProperty("muted", True)
        self._header_help.setWordWrap(True)
        self._header_help.setTextFormat(Qt.TextFormat.RichText)
        header_layout.addWidget(self._header_kicker)
        header_layout.addWidget(self._header_title)
        header_layout.addWidget(self._header_meta)
        header_layout.addWidget(self._header_help)
        root.addWidget(self._header_card)

        filter_row = QHBoxLayout()
        filter_row.setContentsMargins(4, 0, 4, 0)
        filter_hint = QLabel("Show")
        filter_hint.setProperty("muted", True)
        filter_row.addWidget(filter_hint)
        self._filter_combo = QComboBox()
        self._filter_combo.addItem("All included parts", "all")
        self._filter_combo.addItem("Not finished", "missing")
        self._filter_combo.addItem("Finished", "done")
        self._filter_combo.setToolTip("Filter the checklist view (progress is always saved).")
        self._filter_combo.currentIndexChanged.connect(self._on_filter_changed)
        filter_row.addWidget(self._filter_combo)
        save_hint = QLabel(
            "View filter only — printed counts always save to this kit."
        )
        save_hint.setProperty("muted", True)
        save_hint.setWordWrap(True)
        filter_row.addWidget(save_hint, 1)
        root.addLayout(filter_row)

        self.setAutoFillBackground(True)
        self.scroll = QScrollArea()
        self.scroll.setWidgetResizable(True)
        self.scroll.setFrameShape(QFrame.Shape.NoFrame)
        self.scroll.setAttribute(Qt.WidgetAttribute.WA_StyledBackground, True)
        self._document = QWidget()
        self._document.setAttribute(Qt.WidgetAttribute.WA_StyledBackground, True)
        self._document_layout = QVBoxLayout(self._document)
        self._document_layout.setContentsMargins(4, 0, 4, 8)
        self._document_layout.setSpacing(4)
        self.scroll.setWidget(self._document)
        root.addWidget(self.scroll, 1)

    def set_header(self, kit_name: str, order_number: str | None = None) -> None:
        self._kit_name = kit_name.strip()
        self._order_number = (order_number or "").strip() or None

    def load_rows(self, rows: list[dict]) -> None:
        self._rows = list(rows)
        self._rebuild()

    def refresh_rows(self, rows: list[dict]) -> None:
        self._rows = list(rows)
        self._rebuild()

    def _navigate_to_kit(self) -> None:
        win = self.window()
        if hasattr(win, "_set_workflow_index"):
            win._set_workflow_index(1)

    def filter_mode(self) -> str:
        return self._filter_mode

    def _on_filter_changed(self) -> None:
        self._filter_mode = str(self._filter_combo.currentData() or "all")
        self._rebuild()
        self.filter_changed.emit()

    def _filtered_rows(self) -> list[dict]:
        return filter_checkoff_display_rows(self._rows, self._filter_mode)

    def _clear_document(self) -> None:
        while self._document_layout.count():
            item = self._document_layout.takeAt(0)
            if item.widget():
                item.widget().deleteLater()

    def _update_header(self, filtered_count: int) -> None:
        title = self._kit_name or "Build checklist"
        self._header_title.setText(title)
        meta_parts: list[str] = []
        if self._order_number:
            meta_parts.append(f"Order # {self._order_number}")
        meta_parts.append(progress_summary(self._rows))
        if self._filter_mode != "all":
            meta_parts.append(f"showing {filtered_count} in view")
        self._header_meta.setText(" · ".join(meta_parts))

    def _swatch_style(self, hex_color: str) -> str:
        border = self.palette().color(QPalette.ColorRole.Mid).name()
        return f"background: {hex_color}; border: 1px solid {border}; border-radius: 2px;"

    def _rebuild(self) -> None:
        self._clear_document()
        filtered = self._filtered_rows()
        self._update_header(len(filtered))

        if not filtered:
            self._header_card.hide()
            from print_partner.ui.empty_state import EmptyStateWidget

            empty = EmptyStateWidget(
                "No parts to print",
                "Include parts in Kit Compose, then confirm them in Kit Review before checkoff.",
                cta_text="Go back to Kit",
            )
            empty.cta_clicked.connect(self._navigate_to_kit)
            self._document_layout.addWidget(empty)
            return

        self._header_card.show()
        repo_sections = group_checklist_rows(filtered)
        for repo in repo_sections:
            self._document_layout.addWidget(self._repo_heading(repo.label))
            meta = QLabel(f"{repo.part_count} part(s)")
            meta.setProperty("muted", True)
            meta.setContentsMargins(0, 0, 0, 2)
            self._document_layout.addWidget(meta)
            for folder in repo.folders:
                folder_label = folder.label if folder.label != "(root)" else "(root)"
                self._document_layout.addWidget(self._folder_heading(folder_label))
                self._document_layout.addWidget(self._make_table(folder.parts))

        self._document_layout.addStretch(1)

    @staticmethod
    def _repo_heading(text: str) -> QLabel:
        label = QLabel(text)
        label.setObjectName("checklistRepoHeading")
        font = QFont(label.font())
        font.setPointSize(font.pointSize() + 2)
        font.setBold(True)
        label.setFont(font)
        label.setContentsMargins(0, 8, 0, 0)
        return label

    @staticmethod
    def _folder_heading(text: str) -> QLabel:
        label = QLabel(text)
        label.setObjectName("checklistFolderHeading")
        font = QFont(label.font())
        font.setBold(True)
        label.setFont(font)
        label.setContentsMargins(0, 4, 0, 0)
        return label

    def _filename_cell(self, part: ChecklistPartRow) -> QWidget:
        wrap = QWidget()
        row = QHBoxLayout(wrap)
        row.setContentsMargins(4, 2, 4, 2)
        row.setSpacing(6)
        hex_color = part.filament_hex
        if hex_color:
            swatch = QLabel()
            swatch.setFixedSize(12, 12)
            swatch.setStyleSheet(self._swatch_style(hex_color))
            tip = (part.filament_display or "").strip()
            if tip:
                swatch.setToolTip(tip)
            row.addWidget(swatch, 0, Qt.AlignmentFlag.AlignTop)
        text_col = QVBoxLayout()
        text_col.setSpacing(0)
        name = QLabel(part.filename)
        name.setWordWrap(True)
        name_font = QFont(name.font())
        name_font.setBold(True)
        name.setFont(name_font)
        text_col.addWidget(name)
        if part.role:
            role = QLabel(part.role)
            role.setProperty("muted", True)
            text_col.addWidget(role)
        text_wrap = QWidget()
        text_wrap.setLayout(text_col)
        row.addWidget(text_wrap, 1)
        return wrap

    def _make_table(self, parts: list[ChecklistPartRow]) -> QTableWidget:
        table = QTableWidget(len(parts), 6)
        table.setObjectName("checklistPartsTable")
        table.setHorizontalHeaderLabels(
            ["Part", "Qty", "Print", "Verify", "Preview", "Notes"]
        )
        table.setSelectionBehavior(QTableWidget.SelectionBehavior.SelectRows)
        table.setSelectionMode(QTableWidget.SelectionMode.SingleSelection)
        table.verticalHeader().setVisible(False)
        table.setShowGrid(True)
        table.setEditTriggers(QTableWidget.EditTrigger.NoEditTriggers)
        table.setWordWrap(True)
        table.setAlternatingRowColors(True)

        configure_table_columns(
            table,
            stretch_columns=(0, 5),
            fixed_widths={1: 48, 2: 100, 3: _CHECK_COL_WIDTH, 4: 128},
            min_stretch_width=160,
        )
        print_header = table.horizontalHeaderItem(2)
        if print_header:
            print_header.setToolTip("Mark all copies printed")
        verify_header = table.horizontalHeaderItem(3)
        if verify_header:
            verify_header.setToolTip("Customer verified (print only)")

        self._refreshing = True
        for i, part in enumerate(parts):
            table.setCellWidget(i, 0, self._filename_cell(part))
            qty_item = QTableWidgetItem(str(part.quantity))
            qty_item.setData(Qt.ItemDataRole.UserRole, part.id)
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
        pid = part.id
        qty = max(1, part.quantity)

        if qty > 1:
            spin = QSpinBox()
            spin.setRange(0, qty)
            spin.setValue(min(part.printed_count, qty))
            spin.setToolTip(f"Units printed (0–{qty}); saved automatically")
            spin.setMinimumWidth(52)

            def on_spin(value: int) -> None:
                if self._refreshing:
                    return
                self.printed_count_changed.emit(pid, value)

            spin.valueChanged.connect(on_spin)
            layout.addWidget(spin)
            of_label = QLabel(f"/ {qty}")
            of_label.setProperty("muted", True)
            layout.addWidget(of_label)
        else:
            cb = QCheckBox()
            cb.setToolTip("Mark printed (saved automatically)")
            cb.setChecked(part.printed_count >= 1)
            hex_color = part.filament_hex
            if hex_color:
                pal = self.palette()
                border = pal.color(QPalette.ColorRole.Mid).name()
                base = pal.color(QPalette.ColorRole.Base).name()
                cb.setStyleSheet(
                    "QCheckBox::indicator {"
                    f" border: 1px solid {border};"
                    f" background-color: {base};"
                    "}"
                    "QCheckBox::indicator:checked {"
                    f" background-color: {hex_color};"
                    f" border: 1px solid {border};"
                    "}"
                )

            def on_toggle(checked: bool) -> None:
                if self._refreshing:
                    return
                self.printed_toggled.emit(pid, checked)
                self.printed_count_changed.emit(pid, 1 if checked else 0)

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
        qty_item = table.item(rows[0].row(), 1)
        if qty_item:
            pid = qty_item.data(Qt.ItemDataRole.UserRole)
            if pid is not None:
                self.part_selected.emit(int(pid))
