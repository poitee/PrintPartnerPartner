"""Application-wide Qt style and stylesheet."""

from __future__ import annotations

from PySide6.QtGui import QFont, QPalette
from PySide6.QtWidgets import QApplication, QStyleFactory

# Accent tokens (work on light and dark surfaces)
_ACCENT = "#2563a8"
_ACCENT_DARK = "#1a4a7a"
_ACCENT_TEXT = "#ffffff"
_ACCENT_HOVER = "#2f75c4"
_COMPLETE_BORDER = "#4a8f4a"
_BANNER_BORDER = "#c45c00"
_BANNER_BG_LIGHT = "#fff8e6"
_BANNER_BG_DARK = "#3d3420"
_BANNER_EDGE = "#d4a84b"

# Palette-driven QSS — avoids light hardcodes fighting macOS dark mode
_APP_QSS = f"""
* {{
    spacing: 6px;
}}
QMainWindow,
QStackedWidget {{
    background-color: palette(window);
    color: palette(window-text);
}}
QTabWidget::pane {{
    border: 1px solid palette(mid);
    border-radius: 4px;
    top: -1px;
    padding: 4px;
    background-color: palette(base);
    color: palette(text);
}}
QTabBar::tab {{
    padding: 6px 14px;
    margin-right: 2px;
    background-color: palette(button);
    color: palette(button-text);
    border: 1px solid palette(mid);
    border-bottom: none;
    border-top-left-radius: 4px;
    border-top-right-radius: 4px;
}}
QTabBar::tab:selected {{
    background-color: palette(base);
    color: palette(text);
}}
QTabBar::tab:hover {{
    background-color: palette(light);
}}
QGroupBox {{
    font-weight: 600;
    margin-top: 10px;
    padding-top: 10px;
    border: 1px solid palette(mid);
    border-radius: 4px;
    background-color: palette(base);
    color: palette(text);
}}
QGroupBox::title {{
    subcontrol-origin: margin;
    left: 8px;
    padding: 0 6px;
    color: palette(text);
    background-color: palette(base);
}}
QToolBar {{
    spacing: 6px;
    padding: 4px 8px;
    border-bottom: 1px solid palette(mid);
    background-color: palette(window);
    color: palette(window-text);
}}
QTreeWidget,
QTableWidget,
QListWidget,
QComboBox,
QLineEdit,
QTextEdit,
QSpinBox {{
    background-color: palette(base);
    color: palette(text);
    alternate-background-color: palette(alternate-base);
    selection-background-color: palette(highlight);
    selection-color: palette(highlighted-text);
    border: 1px solid palette(mid);
}}
QTreeWidget::item {{
    min-height: 26px;
    padding: 2px 0;
    background: transparent;
    color: palette(text);
}}
QTreeWidget::item:selected {{
    background: palette(highlight);
    color: palette(highlighted-text);
}}
RepoBrowseTree::item:selected {{
    border-left: 3px solid {_ACCENT};
}}
QHeaderView::section {{
    background-color: palette(alternate-base);
    color: palette(text);
    border: 1px solid palette(mid);
    padding: 4px;
}}
QLabel {{
    color: palette(window-text);
    background: transparent;
}}
QLabel[muted="true"] {{
    color: palette(mid);
    font-size: 11px;
}}
QLabel[emptyTitle="true"] {{
    font-size: 14px;
    font-weight: 600;
    color: palette(text);
}}
QLabel[statusMono="true"] {{
    font-family: monospace;
    font-size: 10px;
    color: palette(mid);
}}
QPushButton {{
    padding: 5px 12px;
    min-height: 1.2em;
    border-radius: 4px;
    background-color: palette(button);
    color: palette(button-text);
    border: 1px solid palette(mid);
}}
QPushButton:hover:enabled {{
    background-color: palette(light);
}}
QPushButton:pressed:enabled {{
    background-color: palette(dark);
    color: palette(button-text);
}}
QPushButton:focus {{
    outline: 2px solid {_ACCENT};
    outline-offset: 2px;
}}
QPushButton#primaryButton {{
    font-weight: 600;
    padding: 6px 14px;
}}
QPushButton#primaryButton:enabled {{
    background-color: {_ACCENT};
    color: {_ACCENT_TEXT};
    border: 1px solid {_ACCENT_DARK};
    border-radius: 4px;
}}
QPushButton#primaryButton:hover:enabled {{
    background-color: {_ACCENT_HOVER};
    color: {_ACCENT_TEXT};
}}
QPushButton#primaryButton:pressed:enabled {{
    background-color: {_ACCENT_DARK};
    color: {_ACCENT_TEXT};
}}
QPushButton#primaryButton:disabled {{
    background-color: palette(mid);
    color: palette(shadow);
}}
QPushButton#linkButton {{
    border: none;
    background: transparent;
    color: {_ACCENT};
    text-decoration: underline;
    padding: 2px 4px;
}}
QPushButton#linkButton:hover:enabled {{
    color: {_ACCENT_HOVER};
}}
QCheckBox {{
    color: palette(text);
    spacing: 6px;
}}
QCheckBox::indicator {{
    width: 16px;
    height: 16px;
    border: 1px solid palette(mid);
    border-radius: 3px;
    background-color: palette(base);
}}
QCheckBox::indicator:checked {{
    background-color: palette(highlight);
    border-color: palette(dark);
}}
QCheckBox::indicator:hover {{
    border-color: palette(text);
}}
QFrame#actionCard {{
    background-color: palette(alternate-base);
    border: 1px solid palette(mid);
    border-radius: 4px;
    padding: 4px;
}}
QFrame#kitNameChip {{
    background-color: palette(alternate-base);
    border: 1px solid palette(mid);
    border-radius: 4px;
    padding: 4px 10px;
}}
WorkflowStrip {{
    background-color: palette(alternate-base);
    border-bottom: 2px solid palette(mid);
    color: palette(window-text);
}}
WorkflowStrip QLabel {{
    color: palette(window-text);
}}
WorkflowStrip QLabel[stepRole="arrow"] {{
    color: palette(mid);
    padding: 0 2px;
    font-size: 11px;
}}
WorkflowStrip QPushButton[stepRole="step"] {{
    padding: 5px 12px;
    border: 1px solid palette(mid);
    border-radius: 4px;
    background-color: palette(button);
    color: palette(button-text);
    font-size: 12px;
}}
WorkflowStrip QPushButton[stepRole="step"]:hover:enabled {{
    background-color: palette(light);
    border-color: palette(dark);
}}
WorkflowStrip QPushButton[stepRole="step"][active="true"] {{
    font-weight: 700;
    background-color: {_ACCENT};
    color: {_ACCENT_TEXT};
    border-color: {_ACCENT_DARK};
}}
WorkflowStrip QPushButton[stepRole="step"][complete="true"]:not([active="true"]) {{
    border-color: {_COMPLETE_BORDER};
    color: palette(text);
}}
WorkflowStrip QPushButton[stepRole="step"][locked="true"] {{
    color: palette(mid);
    background-color: palette(midlight);
    border-color: palette(mid);
}}
WorkflowStrip QPushButton[stepRole="step"][locked="true"]:hover {{
    background-color: palette(midlight);
}}
WorkflowStrip QWidget#kitSubRow {{
    background-color: transparent;
}}
WorkflowStrip QPushButton[subRole="substep"] {{
    padding: 3px 10px;
    border: 1px solid transparent;
    border-radius: 3px;
    background: transparent;
    color: palette(button-text);
    font-size: 11px;
}}
WorkflowStrip QPushButton[subRole="substep"]:hover:enabled {{
    background-color: palette(button);
    border-color: palette(mid);
}}
WorkflowStrip QPushButton[subRole="substep"][active="true"] {{
    font-weight: 600;
    background-color: palette(button);
    border-color: {_ACCENT};
    color: {_ACCENT};
}}
BannerWidget {{
    background-color: palette(alternate-base);
    border: 1px solid {_BANNER_EDGE};
    border-left: 4px solid {_BANNER_BORDER};
    border-radius: 2px;
    padding: 2px;
}}
BannerWidget QLabel {{
    color: palette(text);
}}
PrintPlanTab,
ProfileComposer {{
    background-color: palette(window);
    color: palette(window-text);
}}
ProfileComposer QWidget#kitHeader {{
    background-color: palette(window);
    border-bottom: 1px solid palette(mid);
    color: palette(window-text);
}}
ProfileComposer QWidget#kitHeader QLabel {{
    color: palette(window-text);
}}
ProfileComposer QWidget#kitHeader QLabel[emptyTitle="true"] {{
    color: palette(text);
}}
PrintChecklistWidget {{
    background-color: palette(window);
    color: palette(window-text);
}}
PrintChecklistWidget QScrollArea,
PrintChecklistWidget QScrollArea > QWidget > QWidget {{
    background-color: palette(window);
    color: palette(window-text);
}}
PrintChecklistWidget QFrame#checklistHeader {{
    background-color: palette(alternate-base);
    color: palette(text);
    border: 1px solid palette(mid);
    border-radius: 4px;
    margin-bottom: 4px;
}}
PrintChecklistWidget QLabel#checklistKicker {{
    color: palette(mid);
    font-size: 0.8em;
    font-weight: 600;
    letter-spacing: 0.04em;
}}
PrintChecklistWidget QLabel#checklistTitle {{
    color: palette(text);
}}
PrintChecklistWidget QLabel#checklistRepoHeading {{
    color: palette(text);
    border-left: 4px solid {_ACCENT};
    padding-left: 6px;
}}
PrintChecklistWidget QLabel#checklistFolderHeading {{
    color: palette(text);
    padding: 4px 8px;
    background-color: palette(alternate-base);
    border: 1px solid palette(mid);
    border-radius: 2px;
}}
PrintChecklistWidget QTableWidget#checklistPartsTable {{
    background-color: palette(base);
    color: palette(text);
    alternate-background-color: palette(alternate-base);
    gridline-color: palette(mid);
    border: 1px solid palette(mid);
}}
PrintChecklistWidget QTableWidget#checklistPartsTable::item {{
    background-color: palette(base);
    color: palette(text);
}}
PrintChecklistWidget QTableWidget#checklistPartsTable::item:alternate {{
    background-color: palette(alternate-base);
}}
PrintChecklistWidget QTableWidget#checklistPartsTable::item:selected {{
    background-color: palette(highlight);
    color: palette(highlighted-text);
}}
PrintChecklistWidget QTableWidget#checklistPartsTable QWidget {{
    background-color: transparent;
    color: palette(text);
}}
PrintChecklistWidget QTableWidget#checklistPartsTable QLabel {{
    background-color: transparent;
    color: palette(text);
}}
PrintChecklistWidget QTableWidget#checklistPartsTable QLabel[muted="true"] {{
    color: palette(mid);
}}
PrintChecklistWidget QTableWidget#checklistPartsTable QCheckBox {{
    color: palette(text);
}}
PrintChecklistWidget QTableWidget#checklistPartsTable QHeaderView::section {{
    background-color: palette(alternate-base);
    color: palette(text);
    font-weight: 700;
    font-size: 0.85em;
    padding: 6px 4px;
    border: 1px solid palette(mid);
}}
QScrollArea {{
    background-color: palette(window);
    border: none;
}}
StlViewer {{
    background-color: palette(base);
    color: palette(text);
    border: 1px solid palette(mid);
}}
StlViewer QLabel {{
    color: palette(text);
    background: transparent;
}}
QStatusBar {{
    background-color: palette(window);
    color: palette(window-text);
}}
QStatusBar QLabel {{
    color: palette(window-text);
}}
QMenuBar {{
    background-color: palette(window);
    color: palette(window-text);
}}
QMenu {{
    background-color: palette(base);
    color: palette(text);
    border: 1px solid palette(mid);
}}
QMenu::item:selected {{
    background-color: palette(highlight);
    color: palette(highlighted-text);
}}
PartsTreeWidget QTreeWidget#PartsTree {{
    background-color: palette(base);
    color: palette(text);
    border: 1px solid palette(mid);
}}
PartsTreeWidget QTreeWidget#PartsTree::item {{
    min-height: 24px;
    padding: 2px 0;
}}
PartsTreeWidget QTreeWidget#PartsTree::item:selected {{
    background-color: palette(highlight);
    color: palette(highlighted-text);
}}
QLabel#partsSummary {{
    color: palette(text);
    font-weight: 600;
    font-size: 12px;
}}
PrintPlanAssignPanel QFrame#printPlanPoolPane,
PrintPlanAssignPanel QFrame#printPlanPrintersPane {{
    background-color: palette(base);
    border: 1px solid palette(mid);
    border-radius: 6px;
}}
PrintPlanAssignPanel QTreeWidget#PrintPlanPoolTree,
PrintPlanAssignPanel QTreeWidget#PrintPlanPrinterTree {{
    background-color: palette(base);
    color: palette(text);
    border: 1px solid palette(mid);
    border-radius: 4px;
}}
PrintPlanAssignPanel QTreeWidget#PrintPlanPoolTree::item,
PrintPlanAssignPanel QTreeWidget#PrintPlanPrinterTree::item {{
    min-height: 24px;
    padding: 2px 4px;
}}
PrintPlanAssignPanel QHeaderView::section {{
    padding: 4px 6px;
}}
PrintPlanAssignPanel QTreeWidget#PrintPlanPoolTree::item:selected,
PrintPlanAssignPanel QTreeWidget#PrintPlanPrinterTree::item:selected {{
    background-color: palette(highlight);
    color: palette(highlighted-text);
}}
"""


def _luminance(color) -> float:
    r, g, b, _ = color.getRgb()
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def _banner_background(palette: QPalette) -> str:
    """Warm banner tint that reads on light and dark window backgrounds."""
    window = palette.color(QPalette.ColorRole.Window)
    if _luminance(window) < 128:
        return _BANNER_BG_DARK
    return _BANNER_BG_LIGHT


def apply_app_style(app: QApplication) -> None:
    if "Fusion" in QStyleFactory.keys():
        app.setStyle(QStyleFactory.create("Fusion"))
    font = app.font()
    if font.pointSize() <= 0 or font.pointSize() > 12:
        font.setPointSize(12)
    app.setFont(font)
    banner_bg = _banner_background(app.palette())
    qss = _APP_QSS.replace(
        "BannerWidget {{\n    background-color: palette(alternate-base);",
        f"BannerWidget {{\n    background-color: {banner_bg};",
        1,
    )
    app.setStyleSheet(qss)
