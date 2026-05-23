"""Kit tab sub-navigation: Compose | Review."""

from __future__ import annotations

from PySide6.QtCore import Signal
from PySide6.QtWidgets import QHBoxLayout, QLabel, QPushButton, QWidget

_SUB_LABELS = ("Compose", "Review")


class KitSubmodeStrip(QWidget):
    submode_clicked = Signal(str)  # compose | review

    def __init__(self, parent=None) -> None:
        super().__init__(parent)
        self.setObjectName("KitSubmodeStrip")
        self._buttons: list[QPushButton] = []

        layout = QHBoxLayout(self)
        layout.setContentsMargins(8, 4, 8, 4)
        layout.setSpacing(6)

        hint = QLabel("Kit:")
        hint.setProperty("muted", True)
        layout.addWidget(hint)

        for i, label in enumerate(_SUB_LABELS):
            mode = "compose" if i == 0 else "review"
            btn = QPushButton(label)
            btn.setProperty("subRole", "substep")
            btn.setFlat(True)
            btn.clicked.connect(lambda checked=False, m=mode: self.submode_clicked.emit(m))
            self._buttons.append(btn)
            layout.addWidget(btn)

        layout.addStretch(1)
        self.set_submode("compose")

    def set_submode(self, mode: str) -> None:
        idx = 0 if mode == "compose" else 1
        for i, btn in enumerate(self._buttons):
            active = i == idx
            btn.setProperty("active", active)
            btn.style().unpolish(btn)
            btn.style().polish(btn)
