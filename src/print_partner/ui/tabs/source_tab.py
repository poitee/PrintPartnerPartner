"""Source tab — projects, repo browse tree, and documentation."""

from __future__ import annotations

from pathlib import Path

from PySide6.QtCore import Qt
from PySide6.QtWidgets import QHBoxLayout, QSplitter, QVBoxLayout, QWidget

from print_partner.db.models import Project
from print_partner.db.session import db_session
from print_partner.ui.docs_panel import DocsPanel
from print_partner.ui.project_library import ProjectLibrary
from print_partner.ui.repo_browse_tree import RepoBrowseTree


class SourceTab(QWidget):
    def __init__(self, parent=None):
        super().__init__(parent)
        root = QHBoxLayout(self)
        root.setContentsMargins(0, 0, 0, 0)
        outer = QSplitter(Qt.Horizontal)
        root.addWidget(outer)

        left = QSplitter(Qt.Vertical)
        self.project_library = ProjectLibrary()
        left.addWidget(self.project_library)
        self.browse_tree = RepoBrowseTree()
        left.addWidget(self.browse_tree)
        left.setSizes([320, 280])
        outer.addWidget(left)

        self.docs_panel = DocsPanel()
        outer.addWidget(self.docs_panel)
        outer.setSizes([480, 520])

        self.project_library.table.selectionModel().selectionChanged.connect(
            self._on_project_selection_changed
        )
        self.browse_tree.path_selected.connect(self._on_browse_path_selected)
        self._repo_root: Path | None = None

    @property
    def projects_changed(self):
        return self.project_library.projects_changed

    def shutdown(self) -> None:
        self.project_library.shutdown()

    def refresh_projects(self) -> None:
        self.project_library.refresh()

    def _on_project_selection_changed(self) -> None:
        pid = self.project_library._selected_id()
        if pid is None:
            self._repo_root = None
            self.browse_tree.load_repo(None)
            self.docs_panel.load_doc(None, None)
            return
        with db_session() as session:
            proj = session.get(Project, pid)
            if not proj or not proj.local_path:
                self._repo_root = None
                self.browse_tree.load_repo(None)
                self.docs_panel.load_doc(None, None)
                return
            repo_root = Path(proj.local_path)
        self._repo_root = repo_root if repo_root.is_dir() else None
        self.browse_tree.load_repo(self._repo_root)
        self.docs_panel.load_doc(self._repo_root, None)

    def _on_browse_path_selected(self, repo_root: Path | None, relative_path: str) -> None:
        if repo_root is None:
            self.docs_panel.load_doc(None, None)
            return
        self.docs_panel.load_doc(repo_root, relative_path or None)
