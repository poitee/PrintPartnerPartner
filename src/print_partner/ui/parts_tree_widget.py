"""Collapsible repo → directory → STL tree for parts curation."""

from __future__ import annotations

from PySide6.QtCore import QSize, Qt, QTimer, Signal
from PySide6.QtWidgets import (
    QAbstractItemView,
    QCheckBox,
    QHBoxLayout,
    QHeaderView,
    QMenu,
    QSpinBox,
    QTreeWidget,
    QTreeWidgetItem,
    QWidget,
)

from print_partner.core.parts_tree import (
    PartsTreeNode,
    build_profile_parts_tree,
    build_wizard_parts_tree,
    merge_tristates,
    prune_tree_for_filter,
    rollup_tristate,
)
from print_partner.core.scanner import ScannedPart
from print_partner.ui.folder_table_layout import PROFILE_COLUMN_WIDTHS, WIZARD_COLUMN_WIDTHS

_COL_NAME = 0
_COL_ROLE = 1
_COL_QTY = 2
_COL_PRINT = 3
_LEAF_ROW_HEIGHT = 28


class PartsTreeWidget(QWidget):
    inclusion_changed = Signal(object)  # set[int] profile or set[str] wizard
    part_selected = Signal(int)
    tree_path_selected = Signal(str, str)  # repo name, folder path (posix)
    quantity_changed = Signal(int, int)
    all_printed_toggled = Signal(int, bool)

    def __init__(self, *, mode: str = "profile", parent=None):
        super().__init__(parent)
        if mode not in ("profile", "wizard"):
            raise ValueError(f"unknown mode: {mode}")
        self._mode = mode
        self._building = False
        self._included_part_ids: set[int] = set()
        self._included_match_keys: set[str] = set()
        self._all_rows: list[dict] = []
        self._parts: list[ScannedPart] = []
        self._filter_text = ""
        self._hide_printed = False
        self._sort_by_name = True
        self._pinned_folders: list[str] = []
        self._scan_order: dict[str, int] = {}
        self._folder_scan_order: list[str] = []
        self._repo_label = "Parts"
        self._part_items: dict[int, QTreeWidgetItem] = {}
        self._match_key_items: dict[str, QTreeWidgetItem] = {}

        self.tree = QTreeWidget()
        self.tree.setHeaderLabels(["Name", "Role", "Qty", "Print"])
        # Custom widgets per leaf row need per-row height hints; uniform heights
        # and alternating stripes fight embedded widgets on macOS dark theme.
        self.tree.setAlternatingRowColors(False)
        self.tree.setUniformRowHeights(False)
        self.tree.setSelectionBehavior(QAbstractItemView.SelectRows)
        self.tree.setSelectionMode(QAbstractItemView.ExtendedSelection)
        self.tree.setRootIsDecorated(True)
        self.tree.setContextMenuPolicy(Qt.CustomContextMenu)
        self.tree.customContextMenuRequested.connect(self._on_context_menu)
        self.tree.itemChanged.connect(self._on_item_changed)
        self.tree.itemSelectionChanged.connect(self._on_selection_changed)
        self._apply_column_widths()

        layout = QHBoxLayout(self)
        layout.setContentsMargins(0, 0, 0, 0)
        layout.addWidget(self.tree)

        self._filter_debounce = QTimer(self)
        self._filter_debounce.setSingleShot(True)
        self._filter_debounce.setInterval(200)
        self._filter_debounce.timeout.connect(self._rebuild_tree)

    def _apply_column_widths(self) -> None:
        widths = PROFILE_COLUMN_WIDTHS[1:] if self._mode == "profile" else WIZARD_COLUMN_WIDTHS
        header = self.tree.header()
        header.setSectionResizeMode(QHeaderView.Fixed)
        header.setStretchLastSection(False)
        self.tree.setColumnWidth(_COL_NAME, widths[0])
        self.tree.setColumnWidth(_COL_ROLE, widths[1])
        self.tree.setColumnWidth(_COL_QTY, widths[2])
        self.tree.setColumnWidth(_COL_PRINT, widths[3])
        header.setSectionResizeMode(_COL_NAME, QHeaderView.Stretch)

    def set_sort_by_name(self, enabled: bool) -> None:
        self._sort_by_name = enabled
        self._rebuild_tree()

    def set_hide_printed(self, enabled: bool) -> None:
        self._hide_printed = enabled
        self._rebuild_tree()

    def set_pinned_folders(self, folders: list[str]) -> None:
        self._pinned_folders = list(folders)

    def pinned_folders(self) -> list[str]:
        return list(self._pinned_folders)

    def schedule_filter_rebuild(self, text: str) -> None:
        self._filter_text = text
        self._filter_debounce.start()

    def set_filter_text(self, text: str, *, immediate: bool = False) -> None:
        self._filter_text = text
        if immediate:
            self._rebuild_tree()
        else:
            self._filter_debounce.start()

    def expand_all(self) -> None:
        self.tree.expandAll()

    def collapse_all(self) -> None:
        self.tree.collapseAll()

    def load_profile_parts(
        self,
        all_rows: list[dict],
        included_part_ids: set[int],
        *,
        scan_order: dict[str, int] | None = None,
        folder_scan_order: list[str] | None = None,
    ) -> None:
        self._all_rows = list(all_rows)
        self._included_part_ids = set(included_part_ids)
        self._scan_order = scan_order or {}
        self._folder_scan_order = folder_scan_order or []
        self._rebuild_tree()

    def load_wizard_parts(
        self,
        parts: list[ScannedPart],
        included_match_keys: set[str],
        *,
        scan_order: dict[str, int] | None = None,
        folder_scan_order: list[str] | None = None,
        repo_label: str = "Parts",
    ) -> None:
        self._parts = list(parts)
        self._included_match_keys = set(included_match_keys)
        self._scan_order = scan_order or {}
        self._folder_scan_order = folder_scan_order or []
        self._repo_label = repo_label
        self._rebuild_tree()

    def included_part_ids(self) -> set[int]:
        return set(self._included_part_ids)

    def included_match_keys(self) -> set[str]:
        return set(self._included_match_keys)

    def selected_part_ids(self) -> list[int]:
        ids: list[int] = []
        for item in self.tree.selectedItems():
            data = item.data(_COL_NAME, Qt.UserRole)
            if data and data[0] == "part" and self._mode == "profile":
                ids.append(int(data[1]))
        return ids

    def selected_match_keys(self) -> list[str]:
        keys: list[str] = []
        for item in self.tree.selectedItems():
            data = item.data(_COL_NAME, Qt.UserRole)
            if data and data[0] == "part" and self._mode == "wizard":
                keys.append(str(data[1]))
        return keys

    def _build_model(self) -> list[PartsTreeNode]:
        if self._mode == "profile":
            nodes = build_profile_parts_tree(
                self._all_rows,
                included_part_ids=self._included_part_ids,
                query=self._filter_text,
                hide_printed=self._hide_printed,
                sort_by_name=self._sort_by_name,
                pinned_folders=self._pinned_folders,
                scan_order=self._scan_order,
                folder_scan_order_list=self._folder_scan_order,
            )
        else:
            nodes = build_wizard_parts_tree(
                self._parts,
                included_match_keys=self._included_match_keys,
                query=self._filter_text,
                sort_by_name=self._sort_by_name,
                pinned_folders=self._pinned_folders,
                scan_order=self._scan_order,
                folder_scan_order_list=self._folder_scan_order,
                repo_label=self._repo_label,
            )
        return prune_tree_for_filter(nodes, self._filter_text)

    def _rebuild_tree(self) -> None:
        self._building = True
        self.tree.clear()
        self._part_items.clear()
        self._match_key_items.clear()
        model = self._build_model()
        for repo_node in model:
            self._add_node(None, repo_node)
        self._building = False

    def _add_node(self, parent_item: QTreeWidgetItem | None, node: PartsTreeNode) -> QTreeWidgetItem:
        if parent_item is None:
            item = QTreeWidgetItem([node.label, "", "", ""])
            self.tree.addTopLevelItem(item)
        else:
            item = QTreeWidgetItem(parent_item, [node.label, "", "", ""])
        if node.kind in ("repo", "folder"):
            flags = item.flags() | Qt.ItemIsUserCheckable | Qt.ItemIsAutoTristate
            item.setFlags(flags)
            state = rollup_tristate(node.counts.total, node.counts.included)
            item.setCheckState(
                _COL_NAME,
                Qt.Checked if state == "checked" else Qt.PartiallyChecked if state == "partial" else Qt.Unchecked,
            )
            item.setData(_COL_NAME, Qt.UserRole, (node.kind, node.key, node.repo, node.folder_path))
            for child in node.children:
                self._add_node(item, child)
        else:
            item.setFlags(item.flags() & ~Qt.ItemIsUserCheckable)
            if self._mode == "profile" and node.profile_row:
                row = node.profile_row
                part_id = int(row["id"])
                item.setText(_COL_ROLE, row.get("role", ""))
                item.setData(_COL_NAME, Qt.UserRole, ("part", part_id))
                self._part_items[part_id] = item
                self._set_qty_widget(item, row)
                self._set_print_widget(item, part_id in self._included_part_ids)
                self._finalize_leaf_item(item)
            elif self._mode == "wizard" and node.scanned:
                part = node.scanned
                item.setText(_COL_ROLE, part.role)
                item.setData(_COL_NAME, Qt.UserRole, ("part", part.match_key))
                self._match_key_items[part.match_key] = item
                self._set_qty_widget_wizard(item, part)
                self._set_print_widget_wizard(item, part.match_key in self._included_match_keys)
                self._finalize_leaf_item(item)
        return item

    def _finalize_leaf_item(self, item: QTreeWidgetItem) -> None:
        hint = QSize(-1, _LEAF_ROW_HEIGHT)
        for col in range(self.tree.columnCount()):
            item.setSizeHint(col, hint)

    def _prepare_row_widget(self, widget: QWidget) -> QWidget:
        widget.setAutoFillBackground(False)
        widget.setStyleSheet("background: transparent;")
        return widget

    def _set_qty_widget(self, item: QTreeWidgetItem, row: dict) -> None:
        part_id = int(row["id"])
        qty = max(1, row.get("quantity_effective", 1))
        printed_count = row.get("printed_count", 0)

        def on_qty(value: int) -> None:
            if self._building:
                return
            self.quantity_changed.emit(part_id, value)

        def on_printed(checked: bool) -> None:
            if self._building:
                return
            self.all_printed_toggled.emit(part_id, checked)

        widget = self._make_qty_widget(
            qty=qty,
            printed_count=printed_count,
            show_printed=True,
            on_qty_changed=on_qty,
            on_printed_toggled=on_printed,
        )
        self.tree.setItemWidget(item, _COL_QTY, widget)

    def _set_qty_widget_wizard(self, item: QTreeWidgetItem, part: ScannedPart) -> None:
        match_key = part.match_key

        def on_qty(value: int) -> None:
            if self._building:
                return
            for p in self._parts:
                if p.match_key == match_key:
                    p.quantity = value
                    break

        widget = self._make_qty_widget(
            qty=part.quantity,
            printed_count=0,
            show_printed=False,
            on_qty_changed=on_qty,
            on_printed_toggled=lambda _: None,
        )
        self.tree.setItemWidget(item, _COL_QTY, widget)

    def _set_print_widget(self, item: QTreeWidgetItem, included: bool) -> None:
        part_id = int(item.data(_COL_NAME, Qt.UserRole)[1])

        def on_toggled(checked: bool) -> None:
            if self._building:
                return
            if checked:
                self._included_part_ids.add(part_id)
            else:
                self._included_part_ids.discard(part_id)
            self.inclusion_changed.emit(set(self._included_part_ids))

        self.tree.setItemWidget(item, _COL_PRINT, self._make_print_checkbox(included, on_toggled))

    def _set_print_widget_wizard(self, item: QTreeWidgetItem, included: bool) -> None:
        match_key = str(item.data(_COL_NAME, Qt.UserRole)[1])

        def on_toggled(checked: bool) -> None:
            if self._building:
                return
            if checked:
                self._included_match_keys.add(match_key)
            else:
                self._included_match_keys.discard(match_key)
            self.inclusion_changed.emit(set(self._included_match_keys))

        self.tree.setItemWidget(item, _COL_PRINT, self._make_print_checkbox(included, on_toggled))

    def _make_qty_widget(
        self,
        *,
        qty: int,
        printed_count: int,
        show_printed: bool,
        on_qty_changed,
        on_printed_toggled,
    ) -> QWidget:
        container = QWidget()
        layout = QHBoxLayout(container)
        layout.setContentsMargins(4, 0, 4, 0)
        layout.setSpacing(6)
        if show_printed:
            printed_cb = QCheckBox()
            printed_cb.setToolTip("All units printed")
            printed_cb.setChecked(printed_count >= max(1, qty))
            printed_cb.toggled.connect(on_printed_toggled)
            layout.addWidget(printed_cb)
        spin = QSpinBox()
        spin.setRange(1, 999)
        spin.setValue(max(1, qty))
        spin.setMinimumWidth(52)
        spin.valueChanged.connect(on_qty_changed)
        layout.addWidget(spin)
        layout.addStretch()
        return self._prepare_row_widget(container)

    def _make_print_checkbox(self, included: bool, on_toggled) -> QWidget:
        container = QWidget()
        layout = QHBoxLayout(container)
        layout.setContentsMargins(4, 0, 4, 0)
        cb = QCheckBox()
        cb.setToolTip("Include in print")
        cb.setChecked(included)
        cb.toggled.connect(on_toggled)
        layout.addWidget(cb)
        layout.addStretch()
        return self._prepare_row_widget(container)

    def _on_item_changed(self, item: QTreeWidgetItem, column: int) -> None:
        if self._building or column != _COL_NAME:
            return
        data = item.data(_COL_NAME, Qt.UserRole)
        if not data or data[0] not in ("repo", "folder"):
            return
        self._building = True
        state = item.checkState(_COL_NAME)
        self._set_subtree_inclusion(item, state)
        self._sync_parent_checks(item.parent())
        self._building = False
        if self._mode == "profile":
            self.inclusion_changed.emit(set(self._included_part_ids))
        else:
            self.inclusion_changed.emit(set(self._included_match_keys))

    def _set_subtree_inclusion(self, item: QTreeWidgetItem, state: Qt.CheckState) -> None:
        include = state != Qt.Unchecked
        for i in range(item.childCount()):
            child = item.child(i)
            child_data = child.data(_COL_NAME, Qt.UserRole)
            if not child_data:
                continue
            if child_data[0] in ("repo", "folder"):
                child.setCheckState(_COL_NAME, state)
                self._set_subtree_inclusion(child, state)
            elif child_data[0] == "part":
                if self._mode == "profile":
                    part_id = int(child_data[1])
                    if include:
                        self._included_part_ids.add(part_id)
                    else:
                        self._included_part_ids.discard(part_id)
                    self._update_part_print_widget(part_id)
                else:
                    match_key = str(child_data[1])
                    if include:
                        self._included_match_keys.add(match_key)
                    else:
                        self._included_match_keys.discard(match_key)
                    self._update_part_print_widget_key(match_key)

    def _update_part_print_widget(self, part_id: int) -> None:
        item = self._part_items.get(part_id)
        if item is None:
            return
        self._set_print_widget(item, part_id in self._included_part_ids)

    def _update_part_print_widget_key(self, match_key: str) -> None:
        item = self._match_key_items.get(match_key)
        if item is None:
            return
        self._set_print_widget_wizard(item, match_key in self._included_match_keys)

    def _sync_parent_checks(self, parent: QTreeWidgetItem | None) -> None:
        while parent is not None:
            data = parent.data(_COL_NAME, Qt.UserRole)
            if not data or data[0] not in ("repo", "folder"):
                parent = parent.parent()
                continue
            states: list[str] = []
            for i in range(parent.childCount()):
                child = parent.child(i)
                child_data = child.data(_COL_NAME, Qt.UserRole)
                if child_data and child_data[0] == "part":
                    if self._mode == "profile":
                        pid = int(child_data[1])
                        states.append("checked" if pid in self._included_part_ids else "unchecked")
                    else:
                        key = str(child_data[1])
                        states.append("checked" if key in self._included_match_keys else "unchecked")
                elif child_data and child_data[0] in ("repo", "folder"):
                    cs = child.checkState(_COL_NAME)
                    if cs == Qt.Checked:
                        states.append("checked")
                    elif cs == Qt.PartiallyChecked:
                        states.append("partial")
                    else:
                        states.append("unchecked")
            merged = merge_tristates(states)  # type: ignore[arg-type]
            parent.setCheckState(
                _COL_NAME,
                Qt.Checked
                if merged == "checked"
                else Qt.PartiallyChecked
                if merged == "partial"
                else Qt.Unchecked,
            )
            parent = parent.parent()

    def _on_selection_changed(self) -> None:
        if self._mode != "profile":
            return
        items = self.tree.selectedItems()
        if not items:
            return
        data = items[0].data(_COL_NAME, Qt.UserRole)
        if data and data[0] in ("repo", "folder"):
            self.tree_path_selected.emit(str(data[2]), str(data[3]))
            return
        ids = self.selected_part_ids()
        if ids:
            self.part_selected.emit(ids[0])

    def _on_context_menu(self, pos) -> None:
        item = self.tree.itemAt(pos)
        if item is None:
            return
        data = item.data(_COL_NAME, Qt.UserRole)
        if not data or data[0] not in ("repo", "folder"):
            return
        menu = QMenu(self)
        include_action = menu.addAction("Include subtree")
        menu.addAction("Exclude subtree")
        chosen = menu.exec(self.tree.viewport().mapToGlobal(pos))
        if chosen is None:
            return
        include = chosen == include_action
        self._building = True
        state = Qt.Checked if include else Qt.Unchecked
        item.setCheckState(_COL_NAME, state)
        self._set_subtree_inclusion(item, state)
        self._sync_parent_checks(item.parent())
        self._building = False
        if self._mode == "profile":
            self.inclusion_changed.emit(set(self._included_part_ids))
        else:
            self.inclusion_changed.emit(set(self._included_match_keys))

    def apply_bulk_part_ids(self, part_ids: list[int], included: bool) -> None:
        for pid in part_ids:
            if included:
                self._included_part_ids.add(pid)
            else:
                self._included_part_ids.discard(pid)
        self._rebuild_tree()
        self.inclusion_changed.emit(set(self._included_part_ids))

    def apply_bulk_match_keys(self, keys: list[str], included: bool) -> None:
        for key in keys:
            if included:
                self._included_match_keys.add(key)
            else:
                self._included_match_keys.discard(key)
        self._rebuild_tree()
        self.inclusion_changed.emit(set(self._included_match_keys))
