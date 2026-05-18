"""Collapsible folder section for parts curation."""

from __future__ import annotations

from PySide6.QtCore import Qt, Signal
from PySide6.QtWidgets import (
    QAbstractItemView,
    QHBoxLayout,
    QLabel,
    QPushButton,
    QTableWidget,
    QTableWidgetItem,
    QToolButton,
    QVBoxLayout,
    QWidget,
)

from print_partner.core.scanner import ScannedPart


class FolderSectionWidget(QWidget):
    pin_toggled = Signal(str, bool)
    inclusion_changed = Signal()
    printed_unit_toggled = Signal(int, int)  # part_id, unit_index

    def __init__(self, folder: str, *, table_mode: str = "wizard", parent=None):
        super().__init__(parent)
        self.folder = folder
        self.table_mode = table_mode
        self._parts: list[ScannedPart] = []
        self._profile_rows: list[dict] = []
        self._included: set[str] = set()
        self._included_part_ids: set[int] = set()
        self._collapsed = False
        self._pinned = False

        root = QVBoxLayout(self)
        root.setContentsMargins(0, 4, 0, 8)

        header = QHBoxLayout()
        self.btn_collapse = QToolButton()
        self.btn_collapse.setText("▼")
        self.btn_collapse.setFixedWidth(24)
        self.btn_collapse.clicked.connect(self._toggle_collapse)
        header.addWidget(self.btn_collapse)

        self.lbl_folder = QLabel(folder)
        self.lbl_folder.setStyleSheet("font-weight: bold;")
        header.addWidget(self.lbl_folder, 1)

        self.btn_pin = QPushButton("Pin")
        self.btn_pin.setCheckable(True)
        self.btn_pin.clicked.connect(self._on_pin)
        self.btn_inc_folder = QPushButton("Include all")
        self.btn_inc_folder.clicked.connect(lambda: self._set_folder(True))
        self.btn_exc_folder = QPushButton("Exclude all")
        self.btn_exc_folder.clicked.connect(lambda: self._set_folder(False))
        header.addWidget(self.btn_pin)
        header.addWidget(self.btn_inc_folder)
        header.addWidget(self.btn_exc_folder)
        root.addLayout(header)

        self.body = QWidget()
        body_layout = QVBoxLayout(self.body)
        body_layout.setContentsMargins(12, 0, 0, 0)
        col_count = 6 if table_mode == "profile" else 4
        headers = (
            ["Path", "Filename", "Role", "Qty", "Printed", "Print"]
            if table_mode == "profile"
            else ["Filename", "Role", "Qty", "Print"]
        )
        self.table = QTableWidget(0, col_count)
        self.table.setHorizontalHeaderLabels(headers)
        self.table.setSelectionBehavior(QAbstractItemView.SelectRows)
        self.table.setSelectionMode(QAbstractItemView.ExtendedSelection)
        self.table.setMaximumHeight(220)
        if table_mode == "profile":
            self.table.cellClicked.connect(self._on_cell_clicked)
        body_layout.addWidget(self.table)
        root.addWidget(self.body)

    def set_pinned(self, pinned: bool) -> None:
        self._pinned = pinned
        self.btn_pin.setChecked(pinned)
        self.btn_pin.setText("Unpin" if pinned else "Pin")

    def is_pinned(self) -> bool:
        return self._pinned

    def load_parts(self, parts: list[ScannedPart], included: set[str]) -> None:
        self._parts = list(parts)
        self._included = included
        self._refresh_table()

    def load_profile_parts(self, rows: list[dict], included_part_ids: set[int]) -> None:
        self._profile_rows = list(rows)
        self._included_part_ids = set(included_part_ids)
        self._refresh_table()

    def selected_match_keys(self) -> list[str]:
        keys: list[str] = []
        for index in self.table.selectionModel().selectedRows():
            item = self.table.item(index.row(), 0)
            if item:
                key = item.data(Qt.UserRole)
                if key and self.table_mode == "wizard":
                    keys.append(str(key))
        return keys

    def selected_part_ids(self) -> list[int]:
        ids: list[int] = []
        for index in self.table.selectionModel().selectedRows():
            col = 0 if self.table_mode == "profile" else 0
            item = self.table.item(index.row(), col)
            if item:
                pid = item.data(Qt.UserRole)
                if pid is not None and self.table_mode == "profile":
                    ids.append(int(pid))
        return ids

    def set_included_keys(self, included: set[str]) -> None:
        self._included = included
        self._refresh_table()

    def set_included_part_ids(self, included_part_ids: set[int]) -> None:
        self._included_part_ids = set(included_part_ids)
        self._refresh_table()

    def _toggle_collapse(self) -> None:
        self._collapsed = not self._collapsed
        self.body.setVisible(not self._collapsed)
        self.btn_collapse.setText("▶" if self._collapsed else "▼")

    def _on_pin(self) -> None:
        self._pinned = self.btn_pin.isChecked()
        self.btn_pin.setText("Unpin" if self._pinned else "Pin")
        self.pin_toggled.emit(self.folder, self._pinned)

    def _set_folder(self, included: bool) -> None:
        if self.table_mode == "profile":
            for row in self._profile_rows:
                if included:
                    self._included_part_ids.add(row["id"])
                else:
                    self._included_part_ids.discard(row["id"])
        else:
            for part in self._parts:
                if included:
                    self._included.add(part.match_key)
                else:
                    self._included.discard(part.match_key)
        self._refresh_table()
        self.inclusion_changed.emit()

    def _printed_label(self, row: dict) -> str:
        completed = row.get("printed_count", 0)
        total = max(1, row.get("quantity_effective", 1))
        units = row.get("print_units") or []
        if units:
            marks = "".join("✓" if u else "○" for u in units)
            return f"{completed}/{total} {marks}"
        return f"{completed}/{total}"

    def _on_cell_clicked(self, row: int, col: int) -> None:
        if self.table_mode != "profile" or col != 4:
            return
        path_item = self.table.item(row, 0)
        if not path_item:
            return
        part_id = path_item.data(Qt.UserRole)
        if part_id is None:
            return
        profile_row = next((r for r in self._profile_rows if r["id"] == int(part_id)), None)
        if not profile_row:
            return
        units = profile_row.get("print_units") or []
        qty = max(1, profile_row.get("quantity_effective", 1))
        if len(units) < qty:
            units = units + [False] * (qty - len(units))
        next_idx = next((i for i, done in enumerate(units) if not done), 0)
        self.printed_unit_toggled.emit(int(part_id), next_idx)

    def _refresh_table(self) -> None:
        if self.table_mode == "profile":
            self._refresh_profile_table()
        else:
            self._refresh_wizard_table()

    def _refresh_wizard_table(self) -> None:
        self.table.setRowCount(len(self._parts))
        for i, part in enumerate(self._parts):
            self.table.setItem(i, 0, QTableWidgetItem(part.filename))
            self.table.item(i, 0).setData(Qt.UserRole, part.match_key)
            self.table.setItem(i, 1, QTableWidgetItem(part.role))
            self.table.setItem(i, 2, QTableWidgetItem(str(part.quantity)))
            inc = "yes" if part.match_key in self._included else "no"
            self.table.setItem(i, 3, QTableWidgetItem(inc))

    def _refresh_profile_table(self) -> None:
        self.table.setRowCount(len(self._profile_rows))
        for i, row in enumerate(self._profile_rows):
            path_item = QTableWidgetItem(row.get("relative_path", ""))
            path_item.setData(Qt.UserRole, row["id"])
            self.table.setItem(i, 0, path_item)
            self.table.setItem(i, 1, QTableWidgetItem(row.get("filename", "")))
            self.table.setItem(i, 2, QTableWidgetItem(row.get("role", "")))
            self.table.setItem(i, 3, QTableWidgetItem(str(row.get("quantity_effective", 1))))
            printed_item = QTableWidgetItem(self._printed_label(row))
            printed_item.setToolTip("Click to toggle next incomplete unit")
            self.table.setItem(i, 4, printed_item)
            inc = "yes" if row["id"] in self._included_part_ids else "no"
            self.table.setItem(i, 5, QTableWidgetItem(inc))
