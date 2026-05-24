"""Read-only repository directory tree for the Source tab."""

from __future__ import annotations

from pathlib import Path

from PySide6.QtCore import Qt, Signal
from PySide6.QtWidgets import QTreeWidget, QTreeWidgetItem

from print_partner.core.repo_docs import SKIP_DIR_NAMES


class RepoBrowseTree(QTreeWidget):
    path_selected = Signal(object, str)  # repo_root: Path | None, relative_path: str

    def __init__(self, parent=None):
        super().__init__(parent)
        self.setObjectName("RepoBrowseTree")
        self.setHeaderHidden(True)
        self.setAlternatingRowColors(True)
        self.setEditTriggers(QTreeWidget.NoEditTriggers)
        self.currentItemChanged.connect(self._on_current_changed)
        self._repo_root: Path | None = None

    def load_repo(self, repo_root: Path | None) -> None:
        self._repo_root = repo_root.resolve() if repo_root and repo_root.is_dir() else None
        self.clear()
        if self._repo_root is None:
            self.path_selected.emit(None, "")
            return
        root_item = QTreeWidgetItem([self._repo_root.name])
        root_item.setData(0, Qt.UserRole, "")
        self.addTopLevelItem(root_item)
        self._populate_dir(root_item, self._repo_root, "")
        root_item.setExpanded(True)
        self.setCurrentItem(root_item)

    def _populate_dir(self, parent_item: QTreeWidgetItem, abs_dir: Path, rel_dir: str) -> None:
        try:
            entries = sorted(abs_dir.iterdir(), key=lambda p: (not p.is_dir(), p.name.lower()))
        except OSError:
            return
        for entry in entries:
            if entry.name.startswith(".") and entry.name not in (".", ".."):
                continue
            if entry.is_dir() and entry.name in SKIP_DIR_NAMES:
                continue
            rel = f"{rel_dir}/{entry.name}" if rel_dir else entry.name
            if entry.is_dir():
                item = QTreeWidgetItem([entry.name])
                item.setData(0, Qt.UserRole, rel)
                parent_item.addChild(item)
                self._populate_dir(item, entry, rel)
            elif entry.suffix.lower() == ".md":
                item = QTreeWidgetItem([entry.name])
                item.setData(0, Qt.UserRole, rel)
                parent_item.addChild(item)

    def _on_current_changed(
        self, current: QTreeWidgetItem | None, previous: QTreeWidgetItem | None
    ) -> None:
        del previous
        if self._repo_root is None or current is None:
            self.path_selected.emit(None, "")
            return
        rel = current.data(0, Qt.UserRole)
        if rel is None:
            rel = ""
        self.path_selected.emit(self._repo_root, str(rel))
