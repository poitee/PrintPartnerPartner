"""README / docs markdown panel."""

from __future__ import annotations

from pathlib import Path

import markdown
from PySide6.QtWidgets import QTextBrowser

from print_partner.core.repo_readme import read_readme_text


class DocsPanel(QTextBrowser):
    def __init__(self, parent=None):
        super().__init__(parent)
        self.setOpenExternalLinks(True)

    def load_readme(self, repo_path: Path | None) -> None:
        if repo_path is None:
            self.setHtml("<p>No project selected.</p>")
            return
        text = read_readme_text(repo_path)
        if text:
            self.setHtml(markdown.markdown(text, extensions=["tables", "fenced_code"]))
            return
        self.setHtml("<p>No README found in repository.</p>")
