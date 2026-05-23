"""Application-wide Qt style and stylesheet."""

from __future__ import annotations

from PySide6.QtWidgets import QApplication, QStyleFactory

_APP_QSS = """
* {
    spacing: 8px;
}
QTabWidget::pane {
    border: 1px solid #c0c0c0;
    border-radius: 4px;
    top: -1px;
    padding: 4px;
}
QTabBar::tab {
    padding: 6px 14px;
    margin-right: 2px;
}
QGroupBox {
    font-weight: 600;
    margin-top: 10px;
    padding-top: 8px;
}
QGroupBox::title {
    subcontrol-origin: margin;
    left: 8px;
    padding: 0 4px;
}
QToolBar {
    spacing: 8px;
    padding: 4px 8px;
    border-bottom: 1px solid #c8c8c8;
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
    color: palette(mid);
    font-size: 0.9em;
}
QLabel[emptyTitle="true"] {
    font-size: 1.15em;
    font-weight: 600;
    color: palette(text);
}
QPushButton {
    padding: 5px 12px;
    min-height: 1.2em;
}
QPushButton:focus {
    outline: 2px solid palette(highlight);
    outline-offset: 2px;
}
QPushButton#primaryButton {
    font-weight: 600;
    padding: 6px 14px;
}
QPushButton#primaryButton:enabled {
    background-color: palette(highlight);
    color: palette(highlighted-text);
    border: 1px solid palette(dark);
    border-radius: 4px;
}
QPushButton#primaryButton:hover:enabled {
    background-color: palette(light);
    color: palette(highlighted-text);
}
QPushButton#primaryButton:pressed:enabled {
    background-color: palette(dark);
    color: palette(highlighted-text);
}
QPushButton#primaryButton:disabled {
    background-color: palette(mid);
    color: palette(midlight);
}
WorkflowStrip QLabel[stepRole="arrow"] {
    color: #888888;
    padding: 0 4px;
}
WorkflowStrip QPushButton[stepRole="step"] {
    padding: 4px 10px;
    border: 1px solid transparent;
    border-radius: 4px;
    background: transparent;
}
WorkflowStrip QPushButton[stepRole="step"]:hover:enabled {
    background-color: palette(alternate-base);
    border-color: #c0c0c0;
}
WorkflowStrip QPushButton[stepRole="step"][active="true"] {
    font-weight: 600;
    background-color: palette(highlight);
    color: palette(highlighted-text);
    border-color: palette(dark);
}
WorkflowStrip QPushButton[subRole="substep"] {
    padding: 4px 12px;
    border: 1px solid transparent;
    border-radius: 4px;
    background: transparent;
}
WorkflowStrip QPushButton[subRole="substep"]:hover:enabled {
    background-color: palette(alternate-base);
    border-color: #c0c0c0;
}
WorkflowStrip QPushButton[subRole="substep"][active="true"] {
    font-weight: 600;
    background-color: palette(alternate-base);
    border-color: palette(mid);
}
PrintChecklistWidget,
PrintChecklistWidget QScrollArea,
PrintChecklistWidget QScrollArea > QWidget > QWidget {
    background-color: palette(window);
    color: palette(window-text);
}
PrintChecklistWidget QFrame#checklistHeader {
    background-color: palette(base);
    color: palette(text);
    border: 1px solid palette(mid);
    border-radius: 4px;
    margin-bottom: 4px;
}
PrintChecklistWidget QLabel#checklistKicker {
    color: palette(mid);
    font-size: 0.8em;
    font-weight: 600;
    letter-spacing: 0.04em;
}
PrintChecklistWidget QLabel#checklistTitle {
    color: palette(text);
}
PrintChecklistWidget QLabel#checklistRepoHeading {
    color: palette(text);
    border-left: 4px solid palette(text);
    padding-left: 6px;
}
PrintChecklistWidget QLabel#checklistFolderHeading {
    color: palette(text);
    padding: 4px 8px;
    background-color: palette(alternate-base);
    border: 1px solid palette(mid);
    border-radius: 2px;
}
PrintChecklistWidget QTableWidget#checklistPartsTable {
    background-color: palette(base);
    color: palette(text);
    alternate-background-color: palette(alternate-base);
    gridline-color: palette(mid);
    border: 1px solid palette(mid);
}
PrintChecklistWidget QTableWidget#checklistPartsTable::item {
    background-color: palette(base);
    color: palette(text);
}
PrintChecklistWidget QTableWidget#checklistPartsTable::item:alternate {
    background-color: palette(alternate-base);
}
PrintChecklistWidget QTableWidget#checklistPartsTable::item:selected {
    background-color: palette(highlight);
    color: palette(highlighted-text);
}
PrintChecklistWidget QTableWidget#checklistPartsTable QHeaderView::section {
    background-color: palette(alternate-base);
    color: palette(text);
    font-weight: 700;
    font-size: 0.85em;
    padding: 6px 4px;
    border: 1px solid palette(mid);
}
"""


def apply_app_style(app: QApplication) -> None:
    if "Fusion" in QStyleFactory.keys():
        app.setStyle(QStyleFactory.create("Fusion"))
    app.setStyleSheet(_APP_QSS)
