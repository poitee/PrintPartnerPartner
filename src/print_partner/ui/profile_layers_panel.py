"""Profile layers table and layer management actions."""

from __future__ import annotations

from PySide6.QtCore import Qt, Signal
from PySide6.QtWidgets import (
    QAbstractItemView,
    QHBoxLayout,
    QLabel,
    QPushButton,
    QTableWidget,
    QTableWidgetItem,
    QVBoxLayout,
    QWidget,
)


class ProfileLayersPanel(QWidget):
    layers_changed = Signal()
    set_base_requested = Signal()
    add_addon_requested = Signal()
    change_project_requested = Signal(int)  # layer_id
    remove_addon_requested = Signal(int)
    recompute_requested = Signal()

    def __init__(self, parent=None):
        super().__init__(parent)
        self._layers: list[dict] = []

        root = QVBoxLayout(self)
        root.setContentsMargins(0, 0, 0, 0)

        self.header = QLabel("Layers: none")
        self.header.setWordWrap(True)
        self.header.setStyleSheet("font-weight: bold; padding: 4px 0;")
        root.addWidget(self.header)

        self.table = QTableWidget(0, 3)
        self.table.setHorizontalHeaderLabels(["#", "Type", "Project / sync"])
        self.table.setSelectionBehavior(QAbstractItemView.SelectRows)
        self.table.setSelectionMode(QAbstractItemView.SingleSelection)
        self.table.setMaximumHeight(140)
        root.addWidget(self.table)

        buttons = QHBoxLayout()
        self.btn_set_base = QPushButton("Set base…")
        self.btn_set_base.clicked.connect(self.set_base_requested.emit)
        self.btn_add_addon = QPushButton("Add addon…")
        self.btn_add_addon.clicked.connect(self.add_addon_requested.emit)
        self.btn_change = QPushButton("Change project…")
        self.btn_change.clicked.connect(self._emit_change)
        self.btn_remove = QPushButton("Remove addon")
        self.btn_remove.clicked.connect(self._emit_remove)
        self.btn_recompute = QPushButton("Recompute")
        self.btn_recompute.clicked.connect(self.recompute_requested.emit)
        buttons.addWidget(self.btn_set_base)
        buttons.addWidget(self.btn_add_addon)
        buttons.addWidget(self.btn_change)
        buttons.addWidget(self.btn_remove)
        buttons.addWidget(self.btn_recompute)
        root.addLayout(buttons)

    def load_layers(
        self,
        layers: list[dict],
        *,
        order_number: str | None = None,
        profile_name: str = "",
    ) -> None:
        self._layers = list(layers)
        title = profile_name or "Profile"
        if order_number:
            title = f"{title} — Order {order_number}"
        if layers:
            self.header.setText(f"Layers for {title}")
        else:
            self.header.setText(
                f"Layers for {title}: none — add base project and sync on Projects tab."
            )

        self.table.setRowCount(len(layers))
        for i, layer in enumerate(layers):
            num_item = QTableWidgetItem(str(layer.get("layer_order", i) + 1))
            num_item.setData(Qt.UserRole, layer.get("id"))
            self.table.setItem(i, 0, num_item)
            self.table.setItem(i, 1, QTableWidgetItem(layer.get("layer_type", "")))
            self.table.setItem(i, 2, QTableWidgetItem(layer.get("label", "")))

    def selected_layer_id(self) -> int | None:
        rows = self.table.selectionModel().selectedRows()
        if not rows:
            return None
        item = self.table.item(rows[0].row(), 0)
        if item is None:
            return None
        lid = item.data(Qt.UserRole)
        return int(lid) if lid is not None else None

    def _emit_change(self) -> None:
        lid = self.selected_layer_id()
        if lid is not None:
            self.change_project_requested.emit(lid)

    def _emit_remove(self) -> None:
        lid = self.selected_layer_id()
        if lid is not None:
            self.remove_addon_requested.emit(lid)
