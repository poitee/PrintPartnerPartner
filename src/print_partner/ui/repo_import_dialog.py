"""Dialog to opt-in select STL files/folders from a synced repo."""

from __future__ import annotations

from pathlib import Path

from PySide6.QtCore import Qt
from PySide6.QtWidgets import (
    QDialog,
    QDialogButtonBox,
    QHBoxLayout,
    QLabel,
    QLineEdit,
    QPushButton,
    QTreeWidget,
    QTreeWidgetItem,
    QVBoxLayout,
)

from print_partner.core.import_rules import (
    list_stl_relative_paths,
    normalize_relative_path,
    normalize_rule,
    path_matches_rules,
)
from print_partner.core.path_tree import build_path_tree, iter_path_segments


def _compress_rules(checked_files: set[str]) -> list[str]:
    """Compress checked files into folder prefixes where entire subtrees are selected."""
    if not checked_files:
        return []
    # Group by top-level folder
    by_folder: dict[str, set[str]] = {}
    for f in checked_files:
        parts = f.split("/")
        if len(parts) == 1:
            by_folder.setdefault("", set()).add(f)
        else:
            top = parts[0]
            by_folder.setdefault(top, set()).add(f)

    all_files = checked_files

    def folder_all_selected(prefix: str, files_in_tree: list[str]) -> bool:
        prefix_slash = f"{prefix}/" if prefix else ""
        under = {f for f in files_in_tree if f.startswith(prefix_slash) or (not prefix and "/" not in f)}
        return under and under.issubset(all_files)

    rules: list[str] = []
    used: set[str] = set()

    # Try each directory prefix from paths
    dir_prefixes: set[str] = set()
    for f in checked_files:
        parts = f.split("/")
        for i in range(1, len(parts)):
            dir_prefixes.add("/".join(parts[:i]))

    for prefix in sorted(dir_prefixes, key=lambda x: (-x.count("/"), x)):
        if any(f == prefix for f in checked_files if "/" not in f):
            continue
        prefix_files = [f for f in all_files if f.startswith(prefix + "/")]
        if not prefix_files:
            continue
        # All STLs under this prefix in repo must be in checked set
        if all(f in used for f in prefix_files):
            continue
        if set(prefix_files).issubset(all_files):
            # Check no partial - all files with this prefix are selected
            rules.append(normalize_rule(prefix + "/"))
            for f in prefix_files:
                used.add(f)

    for f in sorted(all_files):
        if f not in used:
            rules.append(f)
    return rules


class RepoImportDialog(QDialog):
    def __init__(
        self,
        repo_root: Path,
        current_rules: list[str] | None,
        project_name: str = "",
        parent=None,
    ):
        super().__init__(parent)
        self._repo_root = repo_root.resolve()
        self._all_stls = list_stl_relative_paths(self._repo_root)
        self._rules = current_rules if current_rules is not None else []
        self._result_rules: list[str] = []

        title = f"Import files — {project_name}" if project_name else "Import files"
        self.setWindowTitle(title)
        self.resize(640, 520)

        layout = QVBoxLayout(self)
        layout.addWidget(
            QLabel(
                "Check STL files or folders to include in profiles. "
                "Unchecked files are ignored when building or recomputing."
            )
        )

        toolbar = QHBoxLayout()
        self.filter_edit = QLineEdit()
        self.filter_edit.setPlaceholderText("Filter paths…")
        self.filter_edit.setClearButtonEnabled(True)
        self.filter_edit.textChanged.connect(self._apply_filter)
        toolbar.addWidget(self.filter_edit, 1)
        expand_btn = QPushButton("Expand all")
        expand_btn.clicked.connect(self.tree.expandAll)
        toolbar.addWidget(expand_btn)
        collapse_btn = QPushButton("Collapse all")
        collapse_btn.clicked.connect(self.tree.collapseAll)
        toolbar.addWidget(collapse_btn)
        clear_btn = QPushButton("Clear all")
        clear_btn.clicked.connect(self._clear_all)
        toolbar.addWidget(clear_btn)
        layout.addLayout(toolbar)

        self.tree = QTreeWidget()
        self.tree.setHeaderLabels(["Path", "Type"])
        self.tree.setColumnWidth(0, 480)
        self.tree.itemChanged.connect(self._on_item_changed)
        layout.addWidget(self.tree, 1)

        self.status_label = QLabel()
        layout.addWidget(self.status_label)

        buttons = QDialogButtonBox(QDialogButtonBox.Ok | QDialogButtonBox.Cancel)
        buttons.accepted.connect(self._accept)
        buttons.rejected.connect(self.reject)
        layout.addWidget(buttons)

        self._file_items: dict[str, QTreeWidgetItem] = {}
        self._building = False
        self._build_tree()
        self._apply_initial_checks()
        self._update_status()

    def rules(self) -> list[str]:
        return self._result_rules

    def _build_tree(self) -> None:
        self._building = True
        self.tree.clear()
        self._file_items.clear()
        root_item = self.tree.invisibleRootItem()
        dir_nodes: dict[str, QTreeWidgetItem] = {"": root_item}
        path_root = build_path_tree(self._all_stls)

        def add_dirs(parent_item: QTreeWidgetItem, parent_path: str, node) -> None:
            for seg in sorted(node.subdirs.keys(), key=str.lower):
                sub = node.subdirs[seg]
                path_so_far = sub.path
                folder_item = QTreeWidgetItem(parent_item, [path_so_far, "folder"])
                flags = folder_item.flags() | Qt.ItemIsUserCheckable | Qt.ItemIsAutoTristate
                folder_item.setFlags(flags)
                folder_item.setCheckState(0, Qt.Unchecked)
                folder_item.setData(0, Qt.UserRole, ("folder", path_so_far))
                dir_nodes[path_so_far] = folder_item
                add_dirs(folder_item, path_so_far, sub)
            for rel in sorted(node.files, key=str.lower):
                _dir_parts, _name = iter_path_segments(rel)
                file_item = QTreeWidgetItem(parent_item, [rel, "stl"])
                file_item.setFlags(file_item.flags() | Qt.ItemIsUserCheckable)
                file_item.setCheckState(0, Qt.Unchecked)
                file_item.setData(0, Qt.UserRole, ("file", rel))
                self._file_items[rel] = file_item

        add_dirs(root_item, "", path_root)
        self._building = False

    def _apply_initial_checks(self) -> None:
        if self._rules is None:
            # Legacy: all checked
            self._building = True
            for item in self._file_items.values():
                item.setCheckState(0, Qt.Checked)
            for path, item in self._iter_folder_items():
                item.setCheckState(0, Qt.Checked)
            self._building = False
            return
        if not self._rules:
            return
        self._building = True
        for rel, item in self._file_items.items():
            if path_matches_rules(rel, self._rules):
                item.setCheckState(0, Qt.Checked)
        self._sync_folder_states()
        self._building = False

    def _iter_folder_items(self):
        stack = [self.tree.invisibleRootItem()]
        while stack:
            node = stack.pop()
            for i in range(node.childCount()):
                child = node.child(i)
                data = child.data(0, Qt.UserRole)
                if data and data[0] == "folder":
                    yield data[1], child
                stack.append(child)

    def _sync_folder_states(self) -> None:
        for _path, folder_item in self._iter_folder_items():
            checked = 0
            total = 0
            for i in range(folder_item.childCount()):
                child = folder_item.child(i)
                total += 1
                if child.checkState(0) == Qt.Checked:
                    checked += 1
                elif child.checkState(0) == Qt.PartiallyChecked:
                    folder_item.setCheckState(0, Qt.PartiallyChecked)
                    break
            else:
                if total == 0:
                    continue
                if checked == 0:
                    folder_item.setCheckState(0, Qt.Unchecked)
                elif checked == total:
                    folder_item.setCheckState(0, Qt.Checked)
                else:
                    folder_item.setCheckState(0, Qt.PartiallyChecked)

    def _on_item_changed(self, item: QTreeWidgetItem, column: int) -> None:
        if self._building or column != 0:
            return
        self._building = True
        data = item.data(0, Qt.UserRole)
        state = item.checkState(0)
        if data and data[0] == "folder":
            self._set_children_check(item, state)
        self._sync_folder_states()
        self._building = False
        self._update_status()

    def _set_children_check(self, item: QTreeWidgetItem, state: Qt.CheckState) -> None:
        for i in range(item.childCount()):
            child = item.child(i)
            child.setCheckState(0, state)
            if child.childCount():
                self._set_children_check(child, state)

    def _clear_all(self) -> None:
        self._building = True
        for item in self._file_items.values():
            item.setCheckState(0, Qt.Unchecked)
        for _p, folder_item in self._iter_folder_items():
            folder_item.setCheckState(0, Qt.Unchecked)
        self._building = False
        self._update_status()

    def _apply_filter(self, text: str) -> None:
        needle = text.strip().lower()

        def visit(item: QTreeWidgetItem) -> bool:
            data = item.data(0, Qt.UserRole)
            name = (data[1] if data else item.text(0)).lower()
            child_match = False
            for i in range(item.childCount()):
                if visit(item.child(i)):
                    child_match = True
            show = not needle or needle in name or child_match
            item.setHidden(not show)
            return show

        for i in range(self.tree.topLevelItemCount()):
            visit(self.tree.topLevelItem(i))

    def _checked_files(self) -> set[str]:
        selected: set[str] = set()
        for rel, item in self._file_items.items():
            if item.checkState(0) == Qt.Checked:
                selected.add(rel)
        return selected

    def _update_status(self) -> None:
        selected = len(self._checked_files())
        total = len(self._all_stls)
        self.status_label.setText(f"{selected} of {total} STL files selected")

    def _accept(self) -> None:
        checked = self._checked_files()
        self._result_rules = _compress_rules(checked)
        self.accept()
