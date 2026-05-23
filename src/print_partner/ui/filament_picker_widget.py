"""Ambrosia filament color picker — catalog list, color wheel, hex entry."""

from __future__ import annotations

from PySide6.QtCore import Qt, Signal
from PySide6.QtGui import QColor, QIcon, QPainter, QPixmap
from PySide6.QtWidgets import (
    QColorDialog,
    QComboBox,
    QCompleter,
    QHBoxLayout,
    QLineEdit,
    QPushButton,
    QWidget,
)

from print_partner.core.ambrosia_catalog import AmbrosiaCatalog, AmbrosiaColor, load_catalog
from print_partner.core.filament_color_resolve import (
    UNASSIGNED_FILAMENT_HEX,
    effective_filament_hex,
)
from print_partner.core.mesh_color import normalize_mesh_hex


def _icon_for_hex(hex_color: str, size: int = 16) -> QIcon:
    pixmap = QPixmap(size, size)
    pixmap.fill(QColor(hex_color))
    painter = QPainter(pixmap)
    painter.setPen(QColor("#888888"))
    painter.drawRect(0, 0, size - 1, size - 1)
    painter.end()
    return QIcon(pixmap)


class FilamentPickerWidget(QWidget):
    """Catalog combo with solid swatches, color dialog, and hex field."""

    color_changed = Signal(object, object)  # filament_color_id: str | None, hex: str | None

    def __init__(self, catalog: AmbrosiaCatalog | None = None, parent=None):
        super().__init__(parent)
        self._catalog = catalog or load_catalog()
        self._custom_hex: str | None = None
        self._wheel_edited = False
        self._block_emit = False

        layout = QHBoxLayout(self)
        layout.setContentsMargins(0, 0, 0, 0)

        self.catalog_combo = QComboBox()
        self.catalog_combo.setMinimumWidth(180)
        self.catalog_combo.currentIndexChanged.connect(self._on_catalog_changed)

        self.swatch_btn = QPushButton()
        self.swatch_btn.setFixedSize(28, 28)
        self.swatch_btn.setToolTip("Pick color…")
        self.swatch_btn.clicked.connect(self._open_color_dialog)

        self.hex_edit = QLineEdit()
        self.hex_edit.setPlaceholderText("#RRGGBB")
        self.hex_edit.setMaximumWidth(88)
        self.hex_edit.editingFinished.connect(self._on_hex_edited)

        layout.addWidget(self.catalog_combo, 1)
        layout.addWidget(self.swatch_btn)
        layout.addWidget(self.hex_edit)

        self._populate_catalog()

    def set_catalog(self, catalog: AmbrosiaCatalog) -> None:
        self._catalog = catalog
        select_id = self.selected_color_id()
        self._populate_catalog(select_id=select_id)

    def selected_color_id(self) -> str | None:
        data = self.catalog_combo.currentData()
        if data:
            return str(data)
        return None

    def custom_hex(self) -> str | None:
        return self._custom_hex

    def mesh_hex(self) -> str:
        if self._custom_hex:
            return self._custom_hex
        color_id = self.selected_color_id()
        if color_id:
            color = self._catalog.by_id().get(color_id)
            if color:
                resolved = effective_filament_hex(
                    color.hex, color.display_name, color.product_line
                )
                normalized = normalize_mesh_hex(resolved)
                if normalized:
                    return normalized
        return UNASSIGNED_FILAMENT_HEX

    def set_value(
        self,
        color_id: str | None,
        custom_hex: str | None = None,
    ) -> None:
        self._block_emit = True
        self._custom_hex = normalize_mesh_hex(custom_hex)
        self._wheel_edited = bool(self._custom_hex)
        idx = self.catalog_combo.findData(color_id)
        if idx < 0:
            idx = 0
        self.catalog_combo.setCurrentIndex(idx)
        self._sync_display()
        self._block_emit = False

    def _populate_catalog(self, select_id: str | None = None) -> None:
        self.catalog_combo.blockSignals(True)
        self.catalog_combo.clear()
        self.catalog_combo.addItem("(none)", None)
        none_icon = _icon_for_hex(UNASSIGNED_FILAMENT_HEX)
        self.catalog_combo.setItemIcon(0, none_icon)
        for color in self._catalog.colors:
            mesh_hex = self._color_mesh_hex(color)
            label = color.combo_label
            self.catalog_combo.addItem(label, color.id)
            row = self.catalog_combo.count() - 1
            if mesh_hex:
                self.catalog_combo.setItemIcon(row, _icon_for_hex(mesh_hex))
        completer = QCompleter(
            [self.catalog_combo.itemText(i) for i in range(self.catalog_combo.count())]
        )
        completer.setCaseSensitivity(Qt.CaseInsensitive)
        completer.setFilterMode(Qt.MatchContains)
        self.catalog_combo.setCompleter(completer)
        if select_id:
            idx = self.catalog_combo.findData(select_id)
            if idx >= 0:
                self.catalog_combo.setCurrentIndex(idx)
        self.catalog_combo.blockSignals(False)
        self._sync_display()

    @staticmethod
    def _color_mesh_hex(color: AmbrosiaColor) -> str | None:
        return effective_filament_hex(color.hex, color.display_name, color.product_line)

    def _sync_display(self) -> None:
        hex_val = self.mesh_hex()
        self.hex_edit.blockSignals(True)
        self.hex_edit.setText(hex_val)
        self.hex_edit.blockSignals(False)
        self.swatch_btn.setStyleSheet(
            f"background-color: {hex_val}; border: 1px solid #888;"
        )

    def _emit_changed(self) -> None:
        if self._block_emit:
            return
        self.color_changed.emit(self.selected_color_id(), self._custom_hex)

    def _on_catalog_changed(self) -> None:
        # Catalog pick replaces any prior wheel/hex override.
        self._custom_hex = None
        self._wheel_edited = False
        self._sync_display()
        self._emit_changed()

    def _open_color_dialog(self) -> None:
        initial = QColor(self.mesh_hex())
        chosen = QColorDialog.getColor(initial, self, "Filament color")
        if not chosen.isValid():
            return
        self._custom_hex = normalize_mesh_hex(chosen.name())
        self._wheel_edited = True
        self._sync_display()
        self._emit_changed()

    def _on_hex_edited(self) -> None:
        text = self.hex_edit.text().strip()
        normalized = normalize_mesh_hex(text)
        if not normalized:
            self._sync_display()
            return
        self._custom_hex = normalized
        self._wheel_edited = True
        self._sync_display()
        self._emit_changed()
