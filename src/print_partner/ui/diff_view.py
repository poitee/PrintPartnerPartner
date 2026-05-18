"""Diff summary panel for merge statuses."""

from __future__ import annotations

from PySide6.QtCore import Signal
from PySide6.QtWidgets import (
    QGroupBox,
    QHBoxLayout,
    QLabel,
    QPushButton,
    QVBoxLayout,
    QWidget,
)


class DiffView(QWidget):
    filter_changed = Signal(str)

    def __init__(self, parent=None):
        super().__init__(parent)
        layout = QVBoxLayout(self)
        self.summary = QLabel("No profile loaded")
        layout.addWidget(self.summary)

        box = QGroupBox("Quick filters")
        row = QHBoxLayout(box)
        for label, status in [
            ("All", ""),
            ("Added", "added"),
            ("Replaced", "replaced"),
            ("Conflict", "conflict"),
            ("Excluded", "excluded"),
        ]:
            btn = QPushButton(label)
            btn.clicked.connect(lambda _=False, s=status: self.filter_changed.emit(s))
            row.addWidget(btn)
        layout.addWidget(box)

    def update_counts(self, counts: dict[str, int]) -> None:
        parts = [
            f"base: {counts.get('base', 0)}",
            f"added: {counts.get('added', 0)}",
            f"replaced: {counts.get('replaced', 0)}",
            f"conflict: {counts.get('conflict', 0)}",
            f"excluded: {counts.get('excluded', 0)}",
        ]
        self.summary.setText(" | ".join(parts))
