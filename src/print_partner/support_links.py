"""Public support / donation links."""

from __future__ import annotations

from importlib import resources

from PySide6.QtCore import QUrl
from PySide6.QtGui import QDesktopServices, QIcon

KOFI_URL = "https://ko-fi.com/poitee"
KOFI_BUTTON_LABEL = "Buy me a Coffee"


def kofi_icon() -> QIcon:
    """Bundled Ko-fi cup mark (SVG)."""
    path = resources.files("print_partner.data") / "kofi_cup.svg"
    return QIcon(str(path))


def open_kofi() -> None:
    QDesktopServices.openUrl(QUrl(KOFI_URL))
