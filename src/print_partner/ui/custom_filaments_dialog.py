"""Manage user-defined filament colors (create, edit, share)."""

from __future__ import annotations

import json
from pathlib import Path

from PySide6.QtCore import Qt, Signal
from PySide6.QtGui import QColor
from PySide6.QtWidgets import (
    QColorDialog,
    QDialog,
    QDialogButtonBox,
    QFileDialog,
    QHBoxLayout,
    QHeaderView,
    QInputDialog,
    QLabel,
    QMessageBox,
    QPushButton,
    QTableWidget,
    QTableWidgetItem,
    QVBoxLayout,
)

from print_partner.config import settings
from print_partner.core.custom_filaments import (
    add_custom_filament,
    delete_custom_filament,
    export_library_file,
    import_library_file,
    load_custom_filaments,
    update_custom_filament,
)
from print_partner.core.mesh_color import normalize_mesh_hex
from print_partner.ui.filament_picker_widget import _icon_for_hex


class CustomFilamentsDialog(QDialog):
    """Create, edit, delete, and import/export custom filament library."""

    library_changed = Signal()

    def __init__(self, parent=None) -> None:
        super().__init__(parent)
        self.setWindowTitle("Custom filaments")
        self.setMinimumSize(520, 360)
        self.resize(600, 420)

        layout = QVBoxLayout(self)
        layout.addWidget(
            QLabel(
                "Named colors you define appear in every filament picker. "
                "Export to share with others, or import a library file / shared kit."
            )
        )

        self._table = QTableWidget(0, 4)
        self._table.setHorizontalHeaderLabels(["Name", "Line", "Color", "Id"])
        self._table.horizontalHeader().setSectionResizeMode(0, QHeaderView.Stretch)
        self._table.horizontalHeader().setSectionResizeMode(1, QHeaderView.ResizeToContents)
        self._table.horizontalHeader().setSectionResizeMode(2, QHeaderView.ResizeToContents)
        self._table.setColumnHidden(3, True)
        self._table.setSelectionBehavior(QTableWidget.SelectRows)
        self._table.setSelectionMode(QTableWidget.SingleSelection)
        self._table.doubleClicked.connect(self._edit_selected)
        layout.addWidget(self._table)

        btn_row = QHBoxLayout()
        self._btn_add = QPushButton("Add…")
        self._btn_add.clicked.connect(self._add_filament)
        self._btn_edit = QPushButton("Edit…")
        self._btn_edit.clicked.connect(self._edit_selected)
        self._btn_delete = QPushButton("Delete")
        self._btn_delete.clicked.connect(self._delete_selected)
        btn_row.addWidget(self._btn_add)
        btn_row.addWidget(self._btn_edit)
        btn_row.addWidget(self._btn_delete)
        btn_row.addStretch()
        self._btn_export = QPushButton("Export library…")
        self._btn_export.clicked.connect(self._export_library)
        self._btn_import = QPushButton("Import library…")
        self._btn_import.clicked.connect(self._import_library)
        btn_row.addWidget(self._btn_export)
        btn_row.addWidget(self._btn_import)
        layout.addLayout(btn_row)

        buttons = QDialogButtonBox(QDialogButtonBox.Close)
        buttons.rejected.connect(self.reject)
        layout.addWidget(buttons)

        self._reload_table()

    def _reload_table(self) -> None:
        items = load_custom_filaments()
        self._table.setRowCount(len(items))
        for row, entry in enumerate(items):
            name_item = QTableWidgetItem(entry.display_name)
            name_item.setData(Qt.UserRole, entry.color_id)
            line_item = QTableWidgetItem(entry.product_line)
            hex_item = QTableWidgetItem(entry.hex)
            hex_item.setIcon(_icon_for_hex(entry.hex))
            id_item = QTableWidgetItem(entry.color_id)
            self._table.setItem(row, 0, name_item)
            self._table.setItem(row, 1, line_item)
            self._table.setItem(row, 2, hex_item)
            self._table.setItem(row, 3, id_item)

    def _selected_color_id(self) -> str | None:
        rows = self._table.selectionModel().selectedRows()
        if not rows:
            return None
        item = self._table.item(rows[0].row(), 0)
        if item:
            return str(item.data(Qt.UserRole) or "")
        return None

    def _pick_color(self, initial: str = "#888888") -> str | None:
        chosen = QColorDialog.getColor(QColor(initial), self, "Filament color")
        if not chosen.isValid():
            return None
        return normalize_mesh_hex(chosen.name())

    def _add_filament(self) -> None:
        name, ok = QInputDialog.getText(self, "New custom filament", "Display name:")
        if not ok or not name.strip():
            return
        line, ok = QInputDialog.getText(
            self, "Product line", "Product line (optional):", text="Custom"
        )
        if not ok:
            return
        hex_val = self._pick_color()
        if not hex_val:
            return
        try:
            add_custom_filament(name, hex_val, product_line=line or "Custom")
        except ValueError as exc:
            QMessageBox.warning(self, "Custom filaments", str(exc))
            return
        self._reload_table()
        self.library_changed.emit()

    def _edit_selected(self) -> None:
        color_id = self._selected_color_id()
        if not color_id:
            QMessageBox.information(self, "Custom filaments", "Select a row to edit.")
            return
        row_idx = self._table.selectionModel().selectedRows()[0].row()
        current_name = self._table.item(row_idx, 0).text()
        current_line = self._table.item(row_idx, 1).text()
        current_hex = self._table.item(row_idx, 2).text()

        name, ok = QInputDialog.getText(
            self, "Edit filament", "Display name:", text=current_name
        )
        if not ok:
            return
        line, ok = QInputDialog.getText(
            self, "Product line", "Product line:", text=current_line
        )
        if not ok:
            return
        hex_val = self._pick_color(current_hex)
        if not hex_val:
            return
        try:
            update_custom_filament(
                color_id,
                display_name=name,
                hex_color=hex_val,
                product_line=line,
            )
        except (ValueError, KeyError) as exc:
            QMessageBox.warning(self, "Custom filaments", str(exc))
            return
        self._reload_table()
        self.library_changed.emit()

    def _delete_selected(self) -> None:
        color_id = self._selected_color_id()
        if not color_id:
            QMessageBox.information(self, "Custom filaments", "Select a row to delete.")
            return
        name = self._table.item(self._table.currentRow(), 0).text()
        if (
            QMessageBox.question(
                self,
                "Delete custom filament",
                f"Remove “{name}” from your library?\n\n"
                "Parts already assigned to this color keep the id but may show as unset "
                "on another machine until you re-import the library.",
            )
            != QMessageBox.StandardButton.Yes
        ):
            return
        try:
            delete_custom_filament(color_id)
        except KeyError as exc:
            QMessageBox.warning(self, "Custom filaments", str(exc))
            return
        self._reload_table()
        self.library_changed.emit()

    def _export_library(self) -> None:
        path, _ = QFileDialog.getSaveFileName(
            self,
            "Export custom filaments",
            str(settings.exports_dir / "custom-filaments.json"),
            "JSON (*.json);;All files (*)",
        )
        if not path:
            return
        try:
            export_library_file(Path(path))
        except OSError as exc:
            QMessageBox.critical(self, "Export failed", str(exc))
            return
        QMessageBox.information(
            self,
            "Exported",
            f"Saved {len(load_custom_filaments())} custom filament(s).\n\nShare this file "
            "or include them automatically when you export a kit.",
        )

    def _import_library(self) -> None:
        path, _ = QFileDialog.getOpenFileName(
            self,
            "Import custom filaments",
            str(settings.exports_dir),
            "JSON (*.json);;All files (*)",
        )
        if not path:
            return
        try:
            count = import_library_file(Path(path))
        except (OSError, ValueError, json.JSONDecodeError) as exc:
            QMessageBox.critical(self, "Import failed", str(exc))
            return
        self._reload_table()
        self.library_changed.emit()
        QMessageBox.information(
            self,
            "Imported",
            f"Merged {count} filament definition(s) into your library.",
        )
