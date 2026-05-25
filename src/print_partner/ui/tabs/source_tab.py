"""Libraries tab — repositories, imported files, and documentation."""

from __future__ import annotations

from pathlib import Path

from PySide6.QtCore import Qt
from PySide6.QtWidgets import (
    QFrame,
    QHBoxLayout,
    QLabel,
    QPushButton,
    QSplitter,
    QVBoxLayout,
    QWidget,
)

from print_partner.db.models import Project
from print_partner.db.session import db_session
from print_partner.ui.docs_panel import DocsPanel
from print_partner.ui.project_library import ProjectLibrary
from print_partner.ui.repo_browse_tree import RepoBrowseTree


class SourceTab(QWidget):
    def __init__(self, parent=None):
        super().__init__(parent)
        root = QVBoxLayout(self)
        root.setContentsMargins(8, 8, 8, 8)

        action_card = QFrame()
        action_card.setObjectName("actionCard")
        card_layout = QVBoxLayout(action_card)
        card_layout.setContentsMargins(12, 10, 12, 10)
        card_layout.setSpacing(6)
        card_title = QLabel("<b>Libraries</b> — add sources, sync, then import STLs")
        card_title.setWordWrap(True)
        card_layout.addWidget(card_title)
        steps = QLabel(
            "<ol style='margin:4px 0 8px 18px;padding:0'>"
            "<li><b>Add repository</b> — GitHub URL (clone + sync) or <b>Add local folder…</b> "
            "for files already on disk.</li>"
            "<li><b>Sync</b> selected or all Git repos so STLs are available offline.</li>"
            "<li><b>Import files…</b> — choose which folders/files from a repo become kit parts "
            "(required before Kit → Recompute).</li>"
            "<li><b>Export / import repo list</b> — share your repo table with another machine "
            "(More ▾ on the repository list).</li>"
            "</ol>"
        )
        steps.setWordWrap(True)
        steps.setProperty("muted", True)
        card_layout.addWidget(steps)
        card_btn_row = QHBoxLayout()
        card_btn_row.addStretch(1)
        self.btn_import_files = QPushButton("Import files…")
        self.btn_import_files.setObjectName("primaryButton")
        self.btn_import_files.setToolTip(
            "Open the STL import dialog for the selected repository "
            "(pick folders or patterns to include in kits)."
        )
        self.btn_import_files.clicked.connect(self._import_files_for_selection)
        card_btn_row.addWidget(self.btn_import_files)
        card_layout.addLayout(card_btn_row)
        root.addWidget(action_card)

        outer = QSplitter(Qt.Horizontal)
        root.addWidget(outer, 1)

        left = QSplitter(Qt.Vertical)

        repos_header = QWidget()
        rh = QVBoxLayout(repos_header)
        rh.setContentsMargins(0, 0, 0, 0)
        title = QLabel("Repositories")
        title.setProperty("emptyTitle", True)
        rh.addWidget(title)
        repos_hint = QLabel(
            "Git repos clone into ~/.print-partner/repos. Local folders stay in place. "
            "Select a row to browse files below."
        )
        repos_hint.setProperty("muted", True)
        repos_hint.setWordWrap(True)
        rh.addWidget(repos_hint)
        self.project_library = ProjectLibrary()
        rh.addWidget(self.project_library)
        left.addWidget(repos_header)

        files_header = QWidget()
        fh = QVBoxLayout(files_header)
        fh.setContentsMargins(0, 0, 0, 0)
        row = QHBoxLayout()
        files_title = QLabel("Files in repo")
        files_title.setProperty("emptyTitle", True)
        row.addWidget(files_title)
        row.addStretch(1)
        self.btn_add_local = QPushButton("Add local folder…")
        self.btn_add_local.setToolTip(
            "Register a folder on disk as a project (same as Add local folder in the list)."
        )
        self.btn_add_local.clicked.connect(self.project_library._add_local_folder)
        row.addWidget(self.btn_add_local)
        fh.addLayout(row)
        files_hint = QLabel(
            "Browse synced files; README/docs open on the right. Import rules live in "
            "Import files… for the selected repo."
        )
        files_hint.setProperty("muted", True)
        files_hint.setWordWrap(True)
        fh.addWidget(files_hint)
        self.browse_tree = RepoBrowseTree()
        fh.addWidget(self.browse_tree)
        left.addWidget(files_header)

        left.setSizes([340, 280])
        outer.addWidget(left)

        docs_header = QLabel("Documentation")
        docs_header.setProperty("emptyTitle", True)
        docs_wrap = QWidget()
        docs_layout = QVBoxLayout(docs_wrap)
        docs_layout.setContentsMargins(0, 0, 0, 0)
        docs_layout.addWidget(docs_header)
        self.docs_panel = DocsPanel()
        docs_layout.addWidget(self.docs_panel, 1)
        outer.addWidget(docs_wrap)
        outer.setSizes([500, 500])

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

    def on_libraries_shown(self) -> None:
        """Refresh table and remote update badges when Libraries step is active."""
        self.project_library.refresh()
        self.update_libraries_tab_badge()

    def update_libraries_tab_badge(self) -> None:
        """Expose update count for parent window tab label (no-op if no parent hook)."""
        count = self.project_library.remote_updates_count()
        win = self.window()
        if hasattr(win, "set_libraries_tab_badge"):
            win.set_libraries_tab_badge(count)

    def _import_files_for_selection(self) -> None:
        pid = self.project_library._selected_id()
        if pid is None:
            from PySide6.QtWidgets import QMessageBox

            QMessageBox.information(
                self,
                "Import files",
                "Select a repository in the list first.",
            )
            return
        self.project_library._open_import_dialog(pid, prompt_if_empty=True)

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
