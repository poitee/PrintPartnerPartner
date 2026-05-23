"""Workflow step strip: Libraries → Kit → Checkoff, with Kit sub-modes."""

from __future__ import annotations

from PySide6.QtCore import Signal
from PySide6.QtWidgets import QHBoxLayout, QLabel, QPushButton, QWidget

_STEP_LABELS = ("Libraries", "Kit", "Checkoff")
_KIT_SUB_LABELS = ("Compose", "Review")


class WorkflowStrip(QWidget):
    """Clickable workflow steps synced with main tab indices 0–2."""

    step_clicked = Signal(int)
    kit_submode_clicked = Signal(str)  # compose | review

    def __init__(self, parent=None):
        super().__init__(parent)
        self.setObjectName("WorkflowStrip")
        self._step_buttons: list[QPushButton] = []
        self._kit_sub_buttons: list[QPushButton] = []
        self._current = 0
        self._kit_sub_container = QWidget()

        layout = QHBoxLayout(self)
        layout.setContentsMargins(8, 6, 8, 6)
        layout.setSpacing(8)

        hint = QLabel("Workflow:")
        hint.setProperty("muted", True)
        layout.addWidget(hint)

        for i, label in enumerate(_STEP_LABELS):
            if i > 0:
                arrow = QLabel("→")
                arrow.setProperty("stepRole", "arrow")
                layout.addWidget(arrow)
            btn = QPushButton(label)
            btn.setProperty("stepRole", "step")
            btn.setFlat(True)
            btn.clicked.connect(lambda checked=False, idx=i: self.step_clicked.emit(idx))
            self._step_buttons.append(btn)
            layout.addWidget(btn)

        layout.addStretch(1)

        sub_layout = QHBoxLayout(self._kit_sub_container)
        sub_layout.setContentsMargins(0, 0, 0, 0)
        sub_layout.setSpacing(6)
        kit_hint = QLabel("Kit:")
        kit_hint.setProperty("muted", True)
        sub_layout.addWidget(kit_hint)
        for i, label in enumerate(_KIT_SUB_LABELS):
            mode = "compose" if i == 0 else "review"
            btn = QPushButton(label)
            btn.setProperty("subRole", "substep")
            btn.setFlat(True)
            btn.clicked.connect(lambda checked=False, m=mode: self.kit_submode_clicked.emit(m))
            self._kit_sub_buttons.append(btn)
            sub_layout.addWidget(btn)
        layout.addWidget(self._kit_sub_container)
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

    def set_libraries_badge(self, update_count: int) -> None:
        """Show remote update count on the Libraries step button."""
        if not self._step_buttons:
            return
        label = _STEP_LABELS[0]
        if update_count > 0:
            label = f"{label} ({update_count})"
        self._step_buttons[0].setText(label)

    def set_current_step(self, index: int) -> None:
        if index < 0 or index >= len(self._step_buttons):
            return
        self._current = index
        for i, btn in enumerate(self._step_buttons):
            active = i == index
            btn.setProperty("active", active)
            btn.style().unpolish(btn)
            btn.style().polish(btn)
        self.set_kit_submode_visible(index == 1)
