"""Regression: RepoImportDialog tree must exist before toolbar button wiring."""

from pathlib import Path

from print_partner.ui.repo_import_dialog import _compress_rules


def test_tree_initialized_before_toolbar_wiring():
    src = Path(__file__).resolve().parents[1] / "src/print_partner/ui/repo_import_dialog.py"
    text = src.read_text(encoding="utf-8")
    tree_pos = text.index("self.tree = QTreeWidget()")
    expand_pos = text.index("expand_btn.clicked.connect(self.tree.expandAll)")
    assert tree_pos < expand_pos


def test_compress_rules_folder_prefix():
    files = {"a/x.stl", "a/y.stl"}
    rules = _compress_rules(files)
    assert "a/" in rules or "a/x.stl" in rules
