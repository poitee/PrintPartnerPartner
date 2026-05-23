"""Directory path entry with optional native folder browser."""

from __future__ import annotations

from pathlib import Path

from PySide6.QtCore import Signal
from PySide6.QtWidgets import QFileDialog, QHBoxLayout, QLineEdit, QPushButton, QWidget


def choose_directory(
    parent: QWidget | None,
    title: str = "Choose folder",
    start: str | Path | None = None,
) -> Path | None:
    """Open a native folder picker; returns resolved path or None if cancelled."""
    initial = ""
    if start:
        expanded = Path(str(start)).expanduser()
        if expanded.is_dir():
            initial = str(expanded.resolve())
    chosen = QFileDialog.getExistingDirectory(parent, title, initial)
    if not chosen:
        return None
    return Path(chosen).resolve()


def resolve_directory_input(text: str) -> Path:
    """Validate and resolve a user-typed or pasted folder path."""
    raw = (text or "").strip()
    if not raw:
        raise ValueError("Enter a folder path or use Browse…")
    path = Path(raw).expanduser().resolve()
    if not path.is_dir():
        raise ValueError(f"Not a folder:\n{path}")
    return path


class DirectoryPathEdit(QWidget):
    """Line edit for a folder path plus Browse."""

    path_changed = Signal()

    def __init__(self, parent: QWidget | None = None) -> None:
        super().__init__(parent)
        row = QHBoxLayout(self)
        row.setContentsMargins(0, 0, 0, 0)
        self.edit = QLineEdit()
        self.edit.setPlaceholderText("/path/to/your/stl/folder")
        self.edit.textChanged.connect(self.path_changed.emit)
        row.addWidget(self.edit, 1)
        self.btn_browse = QPushButton("Browse…")
        self.btn_browse.clicked.connect(self._browse)
        row.addWidget(self.btn_browse)

    def path_text(self) -> str:
        return self.edit.text().strip()

    def set_path_text(self, text: str) -> None:
        self.edit.setText(text)

    def set_placeholder(self, text: str) -> None:
        self.edit.setPlaceholderText(text)

    def _browse(self) -> None:
        picked = choose_directory(
            self,
            "Select folder",
            self.path_text() or None,
        )
        if picked is not None:
            self.edit.setText(str(picked))
            self.path_changed.emit()
