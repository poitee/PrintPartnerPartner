"""Application-wide Qt stylesheet."""

from __future__ import annotations

from PySide6.QtWidgets import QApplication

_APP_QSS = """
QTabWidget::pane {
    border: 1px solid #c8c8c8;
    top: -1px;
}
QTabBar::tab {
    padding: 6px 14px;
    margin-right: 2px;
}
QTreeWidget {
    background-color: palette(base);
    alternate-background-color: palette(alternate-base);
}
QTreeWidget::item {
    min-height: 26px;
    padding: 2px 0;
    background: transparent;
}
QTreeWidget::item:selected {
    background: palette(highlight);
    color: palette(highlighted-text);
}
QLabel[muted="true"] {
    color: #555555;
    font-size: 0.9em;
}
QPushButton {
    padding: 4px 10px;
}
"""


def apply_app_style(app: QApplication) -> None:
    app.setStyleSheet(_APP_QSS)
