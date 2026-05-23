"""Centered empty-state placeholder with optional primary action."""

from __future__ import annotations

from PySide6.QtCore import Qt, Signal
from PySide6.QtWidgets import QHBoxLayout, QLabel, QPushButton, QVBoxLayout, QWidget


class EmptyStateWidget(QWidget):
    cta_clicked = Signal()

    def __init__(
        self,
        title: str,
        body: str,
        *,
        cta_text: str | None = None,
        parent=None,
    ) -> None:
        super().__init__(parent)
        layout = QVBoxLayout(self)
        layout.setContentsMargins(24, 32, 24, 32)
        layout.addStretch(1)

        self._title = QLabel(title)
        self._title.setProperty("emptyTitle", True)
        self._title.setWordWrap(True)
        self._title.setAlignment(Qt.AlignmentFlag.AlignCenter)
        layout.addWidget(self._title)

        self._body = QLabel(body)
        self._body.setProperty("muted", True)
        self._body.setWordWrap(True)
        self._body.setAlignment(Qt.AlignmentFlag.AlignCenter)
        layout.addWidget(self._body)

        self._cta: QPushButton | None = None
        if cta_text:
            self._cta = QPushButton(cta_text)
            self._cta.setObjectName("primaryButton")
            self._cta.clicked.connect(self.cta_clicked.emit)
            row = QHBoxLayout()
            row.addStretch(1)
            row.addWidget(self._cta)
            row.addStretch(1)
            layout.addLayout(row)

        layout.addStretch(2)

    def set_content(self, title: str, body: str, *, cta_text: str | None = None) -> None:
        self._title.setText(title)
        self._body.setText(body)
        if self._cta is not None:
            if cta_text:
                self._cta.setText(cta_text)
                self._cta.setVisible(True)
            else:
                self._cta.setVisible(False)
