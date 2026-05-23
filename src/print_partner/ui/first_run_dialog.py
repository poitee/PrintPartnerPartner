"""First-run onboarding dialog."""

from __future__ import annotations

import shutil

from PySide6.QtCore import Qt
from PySide6.QtWidgets import (
    QCheckBox,
    QDialog,
    QDialogButtonBox,
    QFormLayout,
    QLabel,
    QVBoxLayout,
)

from print_partner.config import settings
from print_partner.db.session import get_setting_value, set_setting_value

_SETTING_KEY = "onboarding_complete"


def onboarding_complete() -> bool:
    return (get_setting_value(_SETTING_KEY) or "").lower() in ("1", "true", "yes")


def mark_onboarding_complete() -> None:
    set_setting_value(_SETTING_KEY, "1")


class FirstRunDialog(QDialog):
    """One-time setup hints: git, data directory, optional stl-thumb."""

    def __init__(self, parent=None):
        super().__init__(parent)
        self.setWindowTitle("Welcome to Print Partner")
        self.setModal(True)
        self.resize(480, 320)

        root = QVBoxLayout(self)
        root.addWidget(
            QLabel(
                "<p>Print Partner helps you compose layered STL kits, verify parts, "
                "and export printable checklists.</p>"
                "<p>Workflow: <b>Libraries</b> → <b>Kit</b> (Compose / Review) → <b>Checkoff</b>.</p>"
            )
        )

        form = QFormLayout()
        git_ok = shutil.which("git") is not None
        git_label = QLabel("Found on PATH" if git_ok else "Not found — install Git for repo sync")
        git_label.setStyleSheet("color: green;" if git_ok else "color: #b45309;")
        form.addRow("Git:", git_label)

        data_dir = QLabel(str(settings.data_dir))
        data_dir.setWordWrap(True)
        data_dir.setTextInteractionFlags(Qt.TextInteractionFlag.TextSelectableByMouse)
        form.addRow("Data folder:", data_dir)
        root.addLayout(form)

        thumb = shutil.which("stl-thumb")
        thumb_hint = QLabel(
            "Optional: <code>stl-thumb</code> is installed — faster checklist thumbnails."
            if thumb
            else "Optional: install <code>stl-thumb</code> for faster checklist thumbnails "
            "(see README)."
        )
        thumb_hint.setWordWrap(True)
        root.addWidget(thumb_hint)

        self.dont_show = QCheckBox("Don't show again")
        self.dont_show.setChecked(True)
        root.addWidget(self.dont_show)

        buttons = QDialogButtonBox(QDialogButtonBox.Ok)
        buttons.accepted.connect(self.accept)
        root.addWidget(buttons)

    def accept(self) -> None:
        if self.dont_show.isChecked():
            mark_onboarding_complete()
        super().accept()


def maybe_show_first_run(parent) -> None:
    """Show onboarding once until marked complete."""
    if onboarding_complete():
        return
    dlg = FirstRunDialog(parent)
    dlg.exec()
