"""Inline warning/info banner with optional action button."""

from __future__ import annotations

from PySide6.QtCore import Signal
from PySide6.QtWidgets import QHBoxLayout, QLabel, QPushButton, QWidget


class BannerWidget(QWidget):
    """Industrial warning strip: left accent bar via QSS, message + optional CTA."""

    action_clicked = Signal()

    def __init__(self, parent=None) -> None:
        super().__init__(parent)
        self.setObjectName("BannerWidget")
        self.hide()
        layout = QHBoxLayout(self)
        layout.setContentsMargins(10, 8, 10, 8)
        layout.setSpacing(10)
        self._message = QLabel()
        self._message.setWordWrap(True)
        layout.addWidget(self._message, 1)
        self._action = QPushButton()
        self._action.clicked.connect(self.action_clicked.emit)
        self._action.hide()
        layout.addWidget(self._action)

    def show_message(
        self,
        text: str,
        *,
        action_text: str | None = None,
    ) -> None:
        self._message.setText(text)
        if action_text:
            self._action.setText(action_text)
            self._action.show()
        else:
            self._action.hide()
        self.show()

    def hide_banner(self) -> None:
        self.hide()
