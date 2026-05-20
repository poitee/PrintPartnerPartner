"""README / docs markdown panel."""

from __future__ import annotations

from pathlib import Path

from PySide6.QtCore import Qt
from PySide6.QtWidgets import QLabel, QListWidget, QListWidgetItem, QTextBrowser, QVBoxLayout, QWidget

from print_partner.core.repo_docs import (
    DocRef,
    best_doc_for_relative_path,
    doc_breadcrumb,
    load_markdown_html,
    markdown_files_in_directory,
)


class DocsPanel(QWidget):
    def __init__(self, parent=None):
        super().__init__(parent)
        layout = QVBoxLayout(self)
        layout.setContentsMargins(0, 0, 0, 0)
        self._header = QLabel("Documentation")
        self._header.setWordWrap(True)
        layout.addWidget(self._header)
        self._siblings = QListWidget()
        self._siblings.setMaximumHeight(72)
        self._siblings.setVisible(False)
        self._siblings.itemClicked.connect(self._on_sibling_clicked)
        layout.addWidget(self._siblings)
        self._browser = QTextBrowser()
        self._browser.setOpenExternalLinks(True)
        layout.addWidget(self._browser, 1)
        self._repo_root: Path | None = None
        self._sibling_paths: dict[str, Path] = {}

    def load_readme(self, repo_path: Path | None) -> None:
        if repo_path is None:
            self.load_doc(None, None)
            return
        self.load_doc(repo_path, None)

    def load_doc(self, repo_root: Path | None, relative_path: str | None = None) -> None:
        self._repo_root = repo_root.resolve() if repo_root and repo_root.is_dir() else None
        self._siblings.clear()
        self._siblings.setVisible(False)
        self._sibling_paths.clear()

        if self._repo_root is None:
            self._header.setText("Documentation")
            self._browser.setHtml("<p>No project selected.</p>")
            return

        doc = best_doc_for_relative_path(self._repo_root, relative_path)
        if doc is None:
            self._header.setText(f"{self._repo_root.name} — no README")
            self._browser.setHtml("<p>No README found for this path.</p>")
            return

        self._header.setText(doc_breadcrumb(self._repo_root, doc))
        self._browser.setHtml(load_markdown_html(doc.path))
        self._populate_siblings(doc)

    def _populate_siblings(self, active: DocRef) -> None:
        parent_rel = str(Path(active.relative_path).parent)
        if parent_rel == ".":
            parent_rel = ""
        siblings = markdown_files_in_directory(self._repo_root, parent_rel)
        if len(siblings) <= 1:
            return
        self._siblings.setVisible(True)
        for path in siblings:
            rel = path.relative_to(self._repo_root).as_posix()
            item = QListWidgetItem(path.name)
            item.setData(Qt.UserRole, rel)
            if path == active.path:
                item.setSelected(True)
            self._siblings.addItem(item)
            self._sibling_paths[rel] = path

    def _on_sibling_clicked(self, item: QListWidgetItem) -> None:
        rel = item.data(Qt.UserRole)
        if self._repo_root is None or not rel:
            return
        self.load_doc(self._repo_root, rel)
