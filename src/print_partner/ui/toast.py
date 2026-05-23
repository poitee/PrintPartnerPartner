"""Transient status-bar messages (non-modal success feedback)."""

from __future__ import annotations

from PySide6.QtWidgets import QMainWindow, QWidget


def show_toast(window: QWidget | None, message: str, *, ms: int = 4000) -> None:
    """Show a short message on the main window status bar."""
    if window is None:
        return
    main = window
    while main.parentWidget() is not None:
        main = main.parentWidget()
    if isinstance(main, QMainWindow) and main.statusBar() is not None:
        main.statusBar().showMessage(message, ms)
