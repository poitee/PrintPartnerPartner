"""Assign kit parts from an unclassified pool to printers."""

from __future__ import annotations

from PySide6.QtCore import Qt, Signal
from PySide6.QtGui import QColor, QIcon, QPainter, QPixmap
from PySide6.QtWidgets import (
    QAbstractItemView,
    QComboBox,
    QFrame,
    QHBoxLayout,
    QHeaderView,
    QLabel,
    QLineEdit,
    QMessageBox,
    QPushButton,
    QSplitter,
    QTreeWidget,
    QTreeWidgetItem,
    QVBoxLayout,
    QWidget,
)

from print_partner.core.export_3mf import object_display_name
from print_partner.core.filament_assigner import PartCopy
from print_partner.core.merge import MergePart
from print_partner.core.parts_grouping import folder_key_from_relative_path
from print_partner.core.parts_tree import repo_name_from_source_layer
from print_partner.core.plate_plan import (
    CopyRef,
    KitPlateLayout,
    assign_refs_to_printer,
    auto_plate_layout,
    layout_with_pool,
    printer_assigned_refs,
    prune_layout,
    return_refs_to_pool,
)
from print_partner.core.print_plan_grouping import part_filament_label
from print_partner.core.printer_fleet import PrinterMachine

_ROLE_REF = Qt.ItemDataRole.UserRole
_ROLE_KIND = Qt.ItemDataRole.UserRole + 1


def _configure_tree(
    tree: QTreeWidget,
    primary_header: str,
    *,
    qty_column: bool = False,
) -> None:
    """Readable columns: stretch primary, optional fixed qty, no elision."""
    tree.setAlternatingRowColors(True)
    tree.setTextElideMode(Qt.TextElideMode.ElideNone)
    tree.setHorizontalScrollBarPolicy(Qt.ScrollBarPolicy.ScrollBarAsNeeded)
    tree.setHorizontalScrollMode(QAbstractItemView.ScrollMode.ScrollPerPixel)
    tree.setIndentation(18)
    header = tree.header()
    header.setVisible(True)
    header.setStretchLastSection(False)
    if qty_column:
        tree.setColumnCount(2)
        tree.setHeaderLabels([primary_header, "Qty"])
        header.setSectionResizeMode(0, QHeaderView.ResizeMode.Interactive)
        header.setSectionResizeMode(1, QHeaderView.ResizeMode.Fixed)
        header.resizeSection(1, 44)
        tree.setColumnWidth(0, 420)
    else:
        tree.setColumnCount(1)
        tree.setHeaderLabels([primary_header])
        header.setSectionResizeMode(0, QHeaderView.ResizeMode.Stretch)
        tree.setColumnWidth(0, 420)
    header.setSectionsMovable(False)


def _swatch_icon(hex_color: str | None, size: int = 14) -> QIcon:
    color = QColor(hex_color or "#888888")
    pixmap = QPixmap(size, size)
    pixmap.fill(color)
    painter = QPainter(pixmap)
    painter.setPen(QColor("#666666"))
    painter.drawRect(0, 0, size - 1, size - 1)
    painter.end()
    return QIcon(pixmap)


class PrintPlanAssignPanel(QWidget):
    """Unclassified pool (left) and printers to assign parts to (right)."""

    layout_changed = Signal()

    def __init__(self, parent=None) -> None:
        super().__init__(parent)
        self.setObjectName("PrintPlanAssignPanel")
        self._merge_parts: list[MergePart] = []
        self._fleet: list[PrinterMachine] = []
        self._enabled_ids: list[str] = []
        self._plate_layout: KitPlateLayout | None = None
        self._lookup: dict[tuple[str, int], PartCopy] = {}
        self._target_printer_id: str | None = None
        self._rebuilding = False

        root = QVBoxLayout(self)
        root.setContentsMargins(0, 0, 0, 0)
        root.setSpacing(6)

        hint = QLabel(
            "<b>Assign parts to printers</b> — Select a folder or parts on the left, pick a printer, "
            "then <b>Assign →</b> or <b>Assign folder →</b>. On export, each "
            "<i>filament · repo · folder</i> group becomes one or more named plates."
        )
        hint.setProperty("muted", True)
        hint.setWordWrap(True)
        root.addWidget(hint)

        toolbar = QHBoxLayout()
        self._btn_auto = QPushButton("Auto-assign by filament")
        self._btn_auto.setToolTip("Match parts to printers by loaded filament and pack plates.")
        self._btn_auto.clicked.connect(self.auto_assign_by_filament)
        toolbar.addWidget(self._btn_auto)
        self._btn_assign_folder = QPushButton("Assign folder →")
        self._btn_assign_folder.setToolTip(
            "Assign every unclassified part in the selected repo/folder row to the chosen printer."
        )
        self._btn_assign_folder.clicked.connect(self._assign_selected_folder)
        toolbar.addWidget(self._btn_assign_folder)
        toolbar.addStretch(1)
        self._status = QLabel("")
        self._status.setObjectName("printPlanStatus")
        self._status.setProperty("muted", True)
        toolbar.addWidget(self._status)
        root.addLayout(toolbar)

        splitter = QSplitter(Qt.Horizontal)

        left = QFrame()
        left.setObjectName("printPlanPoolPane")
        left.setMinimumWidth(360)
        left_layout = QVBoxLayout(left)
        left_layout.setContentsMargins(8, 8, 8, 8)
        left_title = QLabel("Unclassified")
        left_title.setProperty("emptyTitle", True)
        left_layout.addWidget(left_title)
        self._pool_filter = QLineEdit()
        self._pool_filter.setPlaceholderText("Filter…")
        self._pool_filter.textChanged.connect(self._refresh_pool_tree)
        left_layout.addWidget(self._pool_filter)
        self._pool_tree = QTreeWidget()
        self._pool_tree.setObjectName("PrintPlanPoolTree")
        _configure_tree(self._pool_tree, "Part · filament · location")
        self._pool_tree.setSelectionMode(QAbstractItemView.SelectionMode.ExtendedSelection)
        self._pool_tree.setRootIsDecorated(True)
        left_layout.addWidget(self._pool_tree, 1)
        splitter.addWidget(left)

        center = QWidget()
        center.setFixedWidth(104)
        center_layout = QVBoxLayout(center)
        center_layout.setContentsMargins(4, 24, 4, 24)
        center_layout.addStretch(1)
        self._assign_combo = QComboBox()
        center_layout.addWidget(self._assign_combo)
        self._btn_assign = QPushButton("Assign →")
        self._btn_assign.setObjectName("primaryButton")
        self._btn_assign.clicked.connect(self._assign_selected_to_printer)
        center_layout.addWidget(self._btn_assign)
        self._btn_unassign = QPushButton("← Unclassify")
        self._btn_unassign.clicked.connect(self._unassign_selected)
        center_layout.addWidget(self._btn_unassign)
        center_layout.addStretch(1)
        splitter.addWidget(center)

        right = QFrame()
        right.setObjectName("printPlanPrintersPane")
        right.setMinimumWidth(360)
        right_layout = QVBoxLayout(right)
        right_layout.setContentsMargins(8, 8, 8, 8)
        right_title = QLabel("Printers")
        right_title.setProperty("emptyTitle", True)
        right_layout.addWidget(right_title)
        self._printer_tree = QTreeWidget()
        self._printer_tree.setObjectName("PrintPlanPrinterTree")
        _configure_tree(self._printer_tree, "Printer / part", qty_column=True)
        self._printer_tree.setSelectionMode(QAbstractItemView.SelectionMode.ExtendedSelection)
        self._printer_tree.itemSelectionChanged.connect(self._on_printer_tree_selection)
        right_layout.addWidget(self._printer_tree, 1)
        splitter.addWidget(right)

        splitter.setStretchFactor(0, 3)
        splitter.setStretchFactor(1, 0)
        splitter.setStretchFactor(2, 3)
        splitter.setSizes([480, 104, 480])
        root.addWidget(splitter, 1)

        self._pool_tree.itemDoubleClicked.connect(
            lambda _item, _col: self._assign_selected_to_printer()
        )
        self._assign_combo.currentIndexChanged.connect(self._on_assign_combo_changed)

    def resizeEvent(self, event) -> None:
        super().resizeEvent(event)
        self._expand_primary_column(self._pool_tree)
        self._expand_primary_column(self._printer_tree)

    def plate_layout(self) -> KitPlateLayout | None:
        return self._plate_layout

    def set_fleet(self, fleet: list[PrinterMachine]) -> None:
        self._fleet = list(fleet)
        self._refresh_assign_combo()
        self.refresh()

    def set_enabled_printer_ids(self, ids: list[str]) -> None:
        self._enabled_ids = list(ids)
        self._refresh_assign_combo()
        self.refresh()

    def set_kit(
        self,
        parts: list[MergePart],
        plate_layout: KitPlateLayout | None,
        *,
        use_pool_if_empty: bool = True,
    ) -> None:
        self._merge_parts = list(parts)
        copies = self._part_copies()
        if plate_layout is None and use_pool_if_empty and copies:
            self._plate_layout = layout_with_pool(copies)
        else:
            self._plate_layout = plate_layout
        if self._plate_layout is not None:
            prune_layout(self._plate_layout, copies)
        self._rebuild_lookup()
        self.refresh()
        if self._plate_layout is not None and use_pool_if_empty:
            self.layout_changed.emit()

    def refresh(self) -> None:
        self._rebuild_lookup()
        self._refresh_assign_combo()
        self._refresh_pool_tree()
        self._refresh_printer_tree()
        self._update_status()

    def set_target_printer(self, printer_id: str | None) -> None:
        if not printer_id:
            return
        idx = self._assign_combo.findData(printer_id)
        if idx >= 0:
            self._assign_combo.setCurrentIndex(idx)
            self._target_printer_id = printer_id

    def auto_assign_by_filament(self) -> None:
        printers = self._enabled_printers()
        copies = self._part_copies()
        if not printers:
            QMessageBox.information(
                self, "Auto-assign", "Enable at least one printer in the sidebar."
            )
            return
        if not copies:
            QMessageBox.information(self, "Auto-assign", "No included parts with STLs.")
            return
        spacing = self._plate_layout.spacing_mm if self._plate_layout else 4.0
        layout, warnings = auto_plate_layout(printers, copies, spacing_mm=spacing)
        self._plate_layout = layout
        self._rebuild_lookup()
        self.refresh()
        self.layout_changed.emit()
        if warnings:
            QMessageBox.warning(
                self,
                "Auto-assign",
                "Assignment complete with notes:\n\n" + "\n".join(warnings[:10]),
            )

    def _enabled_printers(self) -> list[PrinterMachine]:
        enabled = set(self._enabled_ids)
        return [p for p in self._fleet if p.id in enabled]

    def _part_copies(self) -> list[PartCopy]:
        copies: list[PartCopy] = []
        for part in self._merge_parts:
            if not part.included:
                continue
            if not part.absolute_path or not part.absolute_path.is_file():
                continue
            qty = max(1, part.quantity_effective)
            for unit in range(1, qty + 1):
                copies.append(PartCopy(part=part, unit=unit))
        return copies

    def _rebuild_lookup(self) -> None:
        self._lookup = {
            (c.part.match_key, c.unit): c for c in self._part_copies()
        }

    def _ensure_layout(self) -> KitPlateLayout:
        if self._plate_layout is None:
            self._plate_layout = layout_with_pool(self._part_copies())
        return self._plate_layout

    def _emit_changed(self) -> None:
        self.refresh()
        self.layout_changed.emit()

    def _refresh_assign_combo(self) -> None:
        printers = self._enabled_printers()
        prev = self._target_printer_id
        self._assign_combo.blockSignals(True)
        self._assign_combo.clear()
        for p in printers:
            self._assign_combo.addItem(p.name, p.id)
        self._assign_combo.blockSignals(False)
        if not printers:
            self._target_printer_id = None
            self._btn_assign.setEnabled(False)
            return
        self._btn_assign.setEnabled(True)
        if prev:
            idx = self._assign_combo.findData(prev)
            if idx >= 0:
                self._assign_combo.setCurrentIndex(idx)
                return
        self._assign_combo.setCurrentIndex(0)
        self._target_printer_id = self._assign_combo.currentData()

    def _on_assign_combo_changed(self, index: int) -> None:
        if index >= 0:
            self._target_printer_id = self._assign_combo.currentData()

    def _on_printer_tree_selection(self) -> None:
        items = self._printer_tree.selectedItems()
        for item in items:
            data = item.data(0, _ROLE_KIND)
            if data == "printer":
                printer_id = item.data(0, _ROLE_REF)
                if isinstance(printer_id, str):
                    self._target_printer_id = printer_id
                    idx = self._assign_combo.findData(printer_id)
                    if idx >= 0:
                        self._assign_combo.setCurrentIndex(idx)
                return

    def _part_row_label(self, ref: CopyRef) -> tuple[str, str, QIcon | None]:
        copy = self._lookup.get((ref.match_key, ref.unit))
        if copy is None:
            text = f"{ref.match_key} (#{ref.unit})"
            return text, text, None
        repo = repo_name_from_source_layer(copy.part.source_layer)
        folder = folder_key_from_relative_path(copy.part.relative_path)
        used: set[str] = set()
        name = object_display_name(copy.part.filename, copy.unit, used)
        filament = part_filament_label(copy.part)
        folder_label = folder if folder != "(root)" else "(root)"
        display = f"{name}  —  {filament}  —  {repo} / {folder_label}"
        tooltip = f"{name}\nFilament: {filament}\nLocation: {repo} / {folder_label}"
        return display, tooltip, _swatch_icon(copy.part.filament_hex)

    def _add_part_item(
        self,
        parent: QTreeWidgetItem,
        ref: CopyRef,
        *,
        qty: str = "",
    ) -> QTreeWidgetItem:
        display, tooltip, icon = self._part_row_label(ref)
        columns = [display, qty] if qty else [display]
        item = QTreeWidgetItem(columns)
        item.setData(0, _ROLE_KIND, "part")
        item.setData(0, _ROLE_REF, ref)
        item.setToolTip(0, tooltip)
        if icon:
            item.setIcon(0, icon)
        parent.addChild(item)
        return item

    def _refs_under_pool_item(self, item: QTreeWidgetItem) -> list[CopyRef]:
        kind = item.data(0, _ROLE_KIND)
        if kind == "part":
            ref = item.data(0, _ROLE_REF)
            return [ref] if isinstance(ref, CopyRef) else []
        if kind == "folder":
            stored = item.data(0, _ROLE_REF)
            if isinstance(stored, list):
                return [r for r in stored if isinstance(r, CopyRef)]
            refs: list[CopyRef] = []
            for i in range(item.childCount()):
                refs.extend(self._refs_under_pool_item(item.child(i)))
            return refs
        return []

    def _selected_pool_refs(self) -> list[CopyRef]:
        refs: list[CopyRef] = []
        seen: set[tuple[str, int]] = set()
        for item in self._pool_tree.selectedItems():
            for ref in self._refs_under_pool_item(item):
                key = (ref.match_key, ref.unit)
                if key not in seen:
                    seen.add(key)
                    refs.append(ref)
        return refs

    def _selected_printer_refs(self) -> list[CopyRef]:
        refs: list[CopyRef] = []
        for item in self._printer_tree.selectedItems():
            if item.data(0, _ROLE_KIND) != "part":
                continue
            ref = item.data(0, _ROLE_REF)
            if isinstance(ref, CopyRef):
                refs.append(ref)
        return refs

    def _assign_selected_folder(self) -> None:
        folders = [
            item
            for item in self._pool_tree.selectedItems()
            if item.data(0, _ROLE_KIND) == "folder"
        ]
        if not folders:
            QMessageBox.information(
                self,
                "Assign folder",
                "Select a repo/folder row on the left (e.g. “voron-kit / frame/”).",
            )
            return
        refs = self._selected_pool_refs()
        if not refs:
            QMessageBox.information(self, "Assign folder", "No parts in the selected folder.")
            return
        self._assign_refs_to_target(refs)

    def _assign_refs_to_target(self, refs: list[CopyRef]) -> None:
        if not refs:
            return
        printer_id = self._assign_combo.currentData()
        if not printer_id:
            QMessageBox.information(self, "Assign", "Enable a printer and pick it from the list.")
            return
        layout = self._ensure_layout()
        moved = assign_refs_to_printer(layout, refs, str(printer_id))
        if moved:
            self._emit_changed()

    def _assign_selected_to_printer(self) -> None:
        refs = self._selected_pool_refs()
        if not refs:
            QMessageBox.information(
                self,
                "Assign",
                "Select one or more parts, or a repo/folder row on the left.",
            )
            return
        self._assign_refs_to_target(refs)

    def _unassign_selected(self) -> None:
        refs = self._selected_printer_refs()
        if not refs:
            QMessageBox.information(
                self, "Unclassify", "Select parts under a printer on the right."
            )
            return
        layout = self._ensure_layout()
        if return_refs_to_pool(layout, refs):
            self._emit_changed()

    def _refresh_pool_tree(self) -> None:
        self._rebuilding = True
        self._pool_tree.clear()
        layout = self._plate_layout
        if layout is None:
            self._rebuilding = False
            return
        query = self._pool_filter.text().strip().lower()
        refs = list(layout.pool)
        if not refs:
            empty = QTreeWidgetItem(["All parts are assigned to printers."])
            empty.setFlags(Qt.ItemFlag.NoItemFlags)
            self._pool_tree.addTopLevelItem(empty)
            self._rebuilding = False
            return

        buckets: dict[tuple[str, str], list[CopyRef]] = {}
        for ref in refs:
            copy = self._lookup.get((ref.match_key, ref.unit))
            if copy is None:
                buckets.setdefault(("?", "?"), []).append(ref)
                continue
            repo = repo_name_from_source_layer(copy.part.source_layer)
            folder = folder_key_from_relative_path(copy.part.relative_path)
            buckets.setdefault((repo, folder), []).append(ref)

        for repo, folder in sorted(buckets.keys(), key=lambda k: (k[0].lower(), k[1].lower())):
            group_refs = buckets[(repo, folder)]
            folder_label = folder if folder != "(root)" else "(root)"
            group_item = QTreeWidgetItem(
                [f"{repo} / {folder_label}  ({len(group_refs)})"]
            )
            group_item.setData(0, _ROLE_KIND, "folder")
            group_item.setData(0, _ROLE_REF, list(group_refs))
            group_item.setToolTip(
                0,
                f"Select this row and use Assign folder → to send all {len(group_refs)} "
                f"part(s) to the chosen printer.",
            )
            self._pool_tree.addTopLevelItem(group_item)
            for ref in sorted(
                group_refs,
                key=lambda r: self._part_row_label(r)[0].lower(),
            ):
                display, tooltip, _icon = self._part_row_label(ref)
                if query and query not in display.lower():
                    continue
                self._add_part_item(group_item, ref)
            group_item.setExpanded(True)

        self._rebuilding = False
        self._expand_primary_column(self._pool_tree)

    def _refresh_printer_tree(self) -> None:
        self._rebuilding = True
        self._printer_tree.clear()
        printers = self._enabled_printers()
        layout = self._plate_layout
        if not printers:
            empty = QTreeWidgetItem(["Enable printers in the sidebar.", ""])
            empty.setFlags(Qt.ItemFlag.NoItemFlags)
            self._printer_tree.addTopLevelItem(empty)
            self._rebuilding = False
            return

        for printer in printers:
            refs: list[CopyRef] = []
            if layout is not None:
                plan = layout.printer_plan(printer.id)
                if plan is not None:
                    refs = printer_assigned_refs(plan)
            loaded = [
                lf.filament_color_id
                for lf in printer.loaded_filaments
                if lf.filament_color_id
            ]
            slot_hint = f"{len(loaded)} spool(s) loaded" if loaded else "no spools set"
            printer_item = QTreeWidgetItem(
                [f"{printer.name}  ({slot_hint})", str(len(refs))]
            )
            printer_item.setData(0, _ROLE_KIND, "printer")
            printer_item.setData(0, _ROLE_REF, printer.id)
            self._printer_tree.addTopLevelItem(printer_item)
            for ref in refs:
                self._add_part_item(printer_item, ref, qty="1")
            printer_item.setExpanded(True)

        self._rebuilding = False
        self._expand_primary_column(self._printer_tree)

    def _expand_primary_column(self, tree: QTreeWidget) -> None:
        viewport_w = max(tree.viewport().width(), 280)
        if tree.columnWidth(0) < viewport_w:
            tree.setColumnWidth(0, viewport_w)

    def _update_status(self) -> None:
        layout = self._plate_layout
        copies = self._part_copies()
        if not copies:
            self._status.setText("")
            return
        pool_n = len(layout.pool) if layout else len(copies)
        assigned = len(copies) - pool_n
        self._status.setText(f"{assigned} assigned · {pool_n} unclassified")
