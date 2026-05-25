"""Workflow step strip: Libraries → Kit → Print → Checkoff, with Kit sub-modes."""

from __future__ import annotations

from PySide6.QtCore import QSize, Qt, Signal
from PySide6.QtWidgets import QHBoxLayout, QLabel, QPushButton, QVBoxLayout, QWidget

from print_partner.support_links import KOFI_BUTTON_LABEL, kofi_icon, open_kofi

_STEP_LABELS = ("Libraries", "Kit", "Print", "Checkoff")
_STEP_TOOLTIPS = (
    "Add/sync repos and import STL files. (Ctrl+1)",
    "Compose layers, filament, and parts; review before printing. (Ctrl+2)",
    "Configure printers, load filament, export 3MF plates. (Ctrl+3)",
    "Printable checklist, progress tracking, export HTML. (Ctrl+4)",
)
_KIT_SUB_LABELS = ("Compose", "Review")
_STEP_NUMBERS = tuple(range(1, len(_STEP_LABELS) + 1))


def _step_button_text(index: int, *, badge: str = "") -> str:
    label = _STEP_LABELS[index]
    text = f"{_STEP_NUMBERS[index]} {label}"
    if badge:
        text = f"{text} {badge}"
    return text


class WorkflowStrip(QWidget):
    """Clickable workflow steps synced with main tab indices 0–3."""

    step_clicked = Signal(int)
    kit_submode_clicked = Signal(str)  # compose | review

    def __init__(self, parent=None):
        super().__init__(parent)
        self.setObjectName("WorkflowStrip")
        self._step_buttons: list[QPushButton] = []
        self._kit_sub_buttons: list[QPushButton] = []
        self._current = 0
        self._libraries_badge = ""
        self._locked: list[bool] = [False] * len(_STEP_LABELS)
        self._complete: list[bool] = [False] * len(_STEP_LABELS)

        root = QVBoxLayout(self)
        root.setContentsMargins(10, 6, 10, 4)
        root.setSpacing(4)

        main_row = QHBoxLayout()
        main_row.setSpacing(6)
        hint = QLabel("Workflow")
        hint.setProperty("muted", True)
        main_row.addWidget(hint)

        for i, label in enumerate(_STEP_LABELS):
            if i > 0:
                arrow = QLabel("›")
                arrow.setProperty("stepRole", "arrow")
                main_row.addWidget(arrow)
            btn = QPushButton(_step_button_text(i))
            btn.setProperty("stepRole", "step")
            btn.setToolTip(_STEP_TOOLTIPS[i])
            btn.setCursor(Qt.CursorShape.PointingHandCursor)
            btn.clicked.connect(lambda checked=False, idx=i: self.step_clicked.emit(idx))
            self._step_buttons.append(btn)
            main_row.addWidget(btn)

        main_row.addStretch(1)
        kofi_btn = QPushButton(KOFI_BUTTON_LABEL)
        kofi_btn.setObjectName("kofiSupportButton")
        kofi_btn.setIcon(kofi_icon())
        kofi_btn.setIconSize(QSize(24, 24))
        kofi_btn.setToolTip("Support development on Ko-fi")
        kofi_btn.setCursor(Qt.CursorShape.PointingHandCursor)
        kofi_btn.clicked.connect(open_kofi)
        main_row.addWidget(kofi_btn)
        root.addLayout(main_row)

        self._kit_sub_container = QWidget()
        self._kit_sub_container.setObjectName("kitSubRow")
        sub_outer = QHBoxLayout(self._kit_sub_container)
        sub_outer.setContentsMargins(72, 0, 0, 2)
        sub_outer.setSpacing(6)
        kit_hint = QLabel("Kit mode")
        kit_hint.setProperty("muted", True)
        sub_outer.addWidget(kit_hint)
        for i, label in enumerate(_KIT_SUB_LABELS):
            mode = "compose" if i == 0 else "review"
            btn = QPushButton(label)
            btn.setProperty("subRole", "substep")
            btn.setFlat(True)
            btn.setToolTip(
                "Compose: layers, filament, parts tree."
                if mode == "compose"
                else "Review: included parts only before checkoff."
            )
            btn.clicked.connect(lambda checked=False, m=mode: self.kit_submode_clicked.emit(m))
            self._kit_sub_buttons.append(btn)
            sub_outer.addWidget(btn)
        sub_outer.addStretch(1)
        root.addWidget(self._kit_sub_container)
        self._kit_sub_container.hide()

        self.set_current_step(0)
        self.set_kit_submode("compose")

    def set_kit_submode_visible(self, visible: bool) -> None:
        self._kit_sub_container.setVisible(visible)

    def set_kit_submode(self, mode: str) -> None:
        idx = 0 if mode == "compose" else 1
        for i, btn in enumerate(self._kit_sub_buttons):
            active = i == idx
            btn.setProperty("active", active)
            btn.style().unpolish(btn)
            btn.style().polish(btn)

    def set_step_locked(self, index: int, locked: bool) -> None:
        if index < 0 or index >= len(self._locked):
            return
        self._locked[index] = locked
        self._apply_step_style(index)

    def set_step_complete(self, index: int, complete: bool) -> None:
        if index < 0 or index >= len(self._complete):
            return
        self._complete[index] = complete
        self._apply_step_style(index)

    def set_libraries_badge(self, update_count: int) -> None:
        """Show remote update count on the Libraries step button."""
        self._libraries_badge = f"({update_count})" if update_count > 0 else ""
        self._refresh_step_label(0)

    def set_current_step(self, index: int) -> None:
        if index < 0 or index >= len(self._step_buttons):
            return
        self._current = index
        for i in range(len(self._step_buttons)):
            self._apply_step_style(i)

    def _refresh_step_label(self, index: int) -> None:
        if index >= len(self._step_buttons):
            return
        badge = self._libraries_badge if index == 0 else ""
        suffix = ""
        if self._complete[index] and index != self._current:
            suffix = " ✓"
        self._step_buttons[index].setText(_step_button_text(index, badge=badge) + suffix)

    def _apply_step_style(self, index: int) -> None:
        btn = self._step_buttons[index]
        active = index == self._current
        btn.setProperty("active", active)
        btn.setProperty("locked", self._locked[index])
        btn.setProperty("complete", self._complete[index])
        btn.setEnabled(not self._locked[index])
        btn.style().unpolish(btn)
        btn.style().polish(btn)
        self._refresh_step_label(index)
