"""Preview and confirm AI-suggested kit changes."""

from __future__ import annotations

from PySide6.QtWidgets import (
    QCheckBox,
    QDialog,
    QDialogButtonBox,
    QHBoxLayout,
    QTableWidget,
    QTableWidgetItem,
    QVBoxLayout,
    QWidget,
)

from print_partner.core.ai_client import AiAction, action_summary


class AiSuggestionsDialog(QDialog):
    def __init__(self, actions: list[AiAction], parent=None) -> None:
        super().__init__(parent)
        self.setWindowTitle("Apply AI suggestions")
        self.resize(640, 360)
        self._actions = list(actions)
        self._selected: list[AiAction] = []

        layout = QVBoxLayout(self)
        self._table = QTableWidget(len(actions), 3)
        self._table.setHorizontalHeaderLabels(["Apply", "Action", "Details"])
        self._checks: list[QCheckBox] = []
        for i, action in enumerate(actions):
            cb = QCheckBox()
            cb.setChecked(True)
            self._checks.append(cb)
            wrap = QWidget()
            wl = QHBoxLayout(wrap)
            wl.setContentsMargins(4, 0, 4, 0)
            wl.addWidget(cb)
            self._table.setCellWidget(i, 0, wrap)
            atype = action.action_type or action.action
            self._table.setItem(i, 1, QTableWidgetItem(atype))
            detail = QTableWidgetItem(action_summary(action))
            detail.setToolTip(action.reason)
            self._table.setItem(i, 2, detail)
        self._table.resizeColumnsToContents()
        layout.addWidget(self._table)

        buttons = QDialogButtonBox(QDialogButtonBox.Ok | QDialogButtonBox.Cancel)
        buttons.accepted.connect(self._accept)
        buttons.rejected.connect(self.reject)
        layout.addWidget(buttons)

    def selected_actions(self) -> list[AiAction]:
        return list(self._selected)

    def _accept(self) -> None:
        self._selected = [self._actions[i] for i, cb in enumerate(self._checks) if cb.isChecked()]
        self.accept()
