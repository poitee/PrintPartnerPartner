"""Print tab: printer fleet, loaded filament, plate layout, 3MF export."""

from __future__ import annotations

from PySide6.QtCore import Qt, Signal
from PySide6.QtWidgets import (
    QAbstractItemView,
    QCheckBox,
    QDialog,
    QFrame,
    QGroupBox,
    QHBoxLayout,
    QLabel,
    QMenu,
    QMessageBox,
    QPushButton,
    QSplitter,
    QStackedWidget,
    QTableWidget,
    QTableWidgetItem,
    QVBoxLayout,
    QWidget,
)

from print_partner.core.export_3mf import Export3mfOptions
from print_partner.core.filament_assigner import PartCopy
from print_partner.core.merge import MergePart
from print_partner.core.plate_plan import prune_layout, resolve_layout_to_plates
from print_partner.core.print_plan import KitPrintPlan, load_kit_print_plan, save_kit_print_plan
from print_partner.core.printer_fleet import (
    PrinterMachine,
    load_fleet,
    load_printer_presets,
    save_fleet,
)
from print_partner.ui.empty_state import EmptyStateWidget
from print_partner.ui.export_3mf_dialog import Export3mfDialog
from print_partner.ui.filament_picker_widget import FilamentPickerWidget
from print_partner.ui.print_plan_assign_panel import PrintPlanAssignPanel
from print_partner.ui.printer_fleet_dialog import PrinterFleetDialog
from print_partner.ui.table_layout import configure_table_columns


class PrintPlanTab(QWidget):
    """Configure printers and filaments for the active kit; export 3MF."""

    export_3mf_requested = Signal(object)  # Export3mfOptions
    open_kit_library_requested = Signal()

    def __init__(self, parent=None) -> None:
        super().__init__(parent)
        self.setObjectName("PrintPlanTab")
        self._profile_id: int | None = None
        self._profile_name: str = ""
        self._merge_parts: list[MergePart] = []
        self._fleet: list[PrinterMachine] = []
        self._plan = KitPrintPlan()
        self._slot_pickers: list[FilamentPickerWidget] = []
        self._selected_printer_id: str | None = None

        root = QVBoxLayout(self)
        root.setContentsMargins(8, 8, 8, 8)

        self._stack = QStackedWidget()
        self._empty = EmptyStateWidget(
            "No active kit",
            "Open a kit on the Kit tab to configure printers, load filament, and export 3MF plates.",
            cta_text="Open Kit library",
        )
        self._empty.cta_clicked.connect(self.open_kit_library_requested.emit)
        self._stack.addWidget(self._empty)

        self._main = QWidget()
        main_layout = QVBoxLayout(self._main)
        main_layout.setContentsMargins(0, 0, 0, 0)

        print_guide = QFrame()
        print_guide.setObjectName("actionCard")
        pg_layout = QVBoxLayout(print_guide)
        pg_layout.setContentsMargins(10, 8, 10, 8)
        pg_title = QLabel(
            "<b>Print</b> — enable printers, load matching filament on each spool, "
            "then assign parts by folder or individually."
        )
        pg_title.setWordWrap(True)
        pg_layout.addWidget(pg_title)
        pg_steps = QLabel(
            "Select a <b>repo/folder</b> row on the left → <b>Assign folder →</b> to a printer. "
            "Export 3MF names plates as <i>filament · repo · folder</i>."
        )
        pg_steps.setProperty("muted", True)
        pg_steps.setWordWrap(True)
        pg_layout.addWidget(pg_steps)
        main_layout.addWidget(print_guide)

        self._kit_chip = QFrame()
        self._kit_chip.setObjectName("kitNameChip")
        chip_layout = QHBoxLayout(self._kit_chip)
        chip_layout.setContentsMargins(8, 4, 8, 4)
        self._kit_chip_label = QLabel("")
        self._kit_chip_label.setProperty("emptyTitle", True)
        chip_layout.addWidget(self._kit_chip_label)
        main_layout.addWidget(self._kit_chip)

        body_splitter = QSplitter(Qt.Horizontal)

        sidebar = QWidget()
        sidebar.setMaximumWidth(340)
        sidebar_layout = QVBoxLayout(sidebar)
        sidebar_layout.setContentsMargins(0, 0, 0, 0)
        fleet_box = QGroupBox("Printers")
        fleet_layout = QVBoxLayout(fleet_box)
        self._printer_table = QTableWidget(0, 3)
        self._printer_table.setHorizontalHeaderLabels(["Use", "Printer", "Bed"])
        configure_table_columns(
            self._printer_table,
            stretch_columns=(1,),
            fixed_widths={0: 44, 2: 88},
        )
        self._printer_table.setSelectionBehavior(QAbstractItemView.SelectRows)
        self._printer_table.setSelectionMode(QAbstractItemView.SingleSelection)
        self._printer_table.itemSelectionChanged.connect(self._on_printer_selected)
        fleet_layout.addWidget(self._printer_table)
        btn_row = QHBoxLayout()
        self._btn_add = QPushButton("Add…")
        self._btn_add.setObjectName("primaryButton")
        self._btn_add.clicked.connect(self._add_printer)
        self._btn_printer_more = QPushButton("▾")
        self._btn_printer_more.setToolTip("Edit or remove printer")
        printer_menu = QMenu(self)
        printer_menu.addAction("Edit…", self._edit_printer)
        printer_menu.addAction("Remove", self._remove_printer)
        self._btn_printer_more.setMenu(printer_menu)
        btn_row.addWidget(self._btn_add)
        btn_row.addWidget(self._btn_printer_more)
        btn_row.addStretch(1)
        fleet_layout.addLayout(btn_row)
        sidebar_layout.addWidget(fleet_box)

        self._filament_box = QGroupBox("Loaded spools")
        self._filament_layout = QVBoxLayout(self._filament_box)
        self._filament_hint = QLabel(
            "Select a printer, then set each spool to the filament loaded on that machine. "
            "Auto-assign uses these colors to pick a printer."
        )
        self._filament_hint.setProperty("muted", True)
        self._filament_hint.setWordWrap(True)
        self._filament_layout.addWidget(self._filament_hint)
        sidebar_layout.addWidget(self._filament_box)
        sidebar_layout.addStretch(1)
        body_splitter.addWidget(sidebar)

        self._assign_panel = PrintPlanAssignPanel()
        self._assign_panel.layout_changed.connect(self._on_plate_layout_changed)
        body_splitter.addWidget(self._assign_panel)

        body_splitter.setStretchFactor(0, 0)
        body_splitter.setStretchFactor(1, 1)
        main_layout.addWidget(body_splitter, 1)

        export_row = QHBoxLayout()
        hint = QLabel("Assign all parts to printers, then export (plates pack automatically).")
        hint.setProperty("muted", True)
        export_row.addWidget(hint, 1)
        self._btn_export = QPushButton("Export 3MF…")
        self._btn_export.setObjectName("primaryButton")
        self._btn_export.clicked.connect(self._export_3mf)
        export_row.addWidget(self._btn_export)
        main_layout.addLayout(export_row)

        self._stack.addWidget(self._main)
        root.addWidget(self._stack, 1)

        self._reload_fleet()
        self._stack.setCurrentIndex(0)

    def set_kit(self, profile_id: int | None, profile_name: str, parts: list[MergePart]) -> None:
        self._profile_id = profile_id
        self._profile_name = profile_name or ""
        self._merge_parts = parts
        if profile_id is None:
            self._stack.setCurrentIndex(0)
            self._btn_export.setEnabled(False)
            self._assign_panel.set_kit([], None, use_pool_if_empty=False)
            return
        self._stack.setCurrentIndex(1)
        self._kit_chip_label.setText(f"Kit: {self._profile_name}")
        self._plan = load_kit_print_plan(profile_id)
        self._assign_panel.set_fleet(self._fleet)
        self._assign_panel.set_enabled_printer_ids(self._plan.enabled_printer_ids or [])
        self._assign_panel.set_kit(
            parts,
            self._plan.plate_layout,
            use_pool_if_empty=True,
        )
        self._btn_export.setEnabled(True)
        self._reload_printer_table()

    def _on_plate_layout_changed(self) -> None:
        self._plan.plate_layout = self._assign_panel.plate_layout()
        self._save_plan()

    def _save_plan(self) -> None:
        if self._profile_id is None:
            return
        save_kit_print_plan(self._profile_id, self._plan)

    def _reload_fleet(self) -> None:
        self._fleet = load_fleet()
        self._assign_panel.set_fleet(self._fleet)
        self._reload_printer_table()

    def _enabled_printers(self) -> list[PrinterMachine]:
        enabled = set(self._plan.enabled_printer_ids or [])
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

    def _reload_printer_table(self) -> None:
        self._printer_table.setRowCount(len(self._fleet))
        enabled = set(self._plan.enabled_printer_ids or [])
        for row, printer in enumerate(self._fleet):
            cb = QCheckBox()
            cb.setChecked(printer.id in enabled)
            cb.stateChanged.connect(
                lambda _state, pid=printer.id, box=cb: self._toggle_printer(pid, box.isChecked())
            )
            self._printer_table.setCellWidget(row, 0, cb)
            self._printer_table.setItem(row, 1, QTableWidgetItem(printer.name))
            bed = f"{printer.bed_width_mm:.0f}×{printer.bed_depth_mm:.0f} mm"
            self._printer_table.setItem(row, 2, QTableWidgetItem(bed))

    def _toggle_printer(self, printer_id: str, enabled: bool) -> None:
        ids = list(self._plan.enabled_printer_ids or [])
        if enabled:
            if printer_id not in ids:
                ids.append(printer_id)
        else:
            ids = [x for x in ids if x != printer_id]
        self._plan.enabled_printer_ids = ids
        self._assign_panel.set_enabled_printer_ids(ids)
        self._save_plan()

    def _on_printer_selected(self) -> None:
        rows = self._printer_table.selectionModel().selectedRows()
        if not rows:
            self._selected_printer_id = None
            self._rebuild_filament_pickers(None)
            return
        row = rows[0].row()
        if row < 0 or row >= len(self._fleet):
            return
        printer = self._fleet[row]
        self._selected_printer_id = printer.id
        self._assign_panel.set_target_printer(printer.id)
        self._rebuild_filament_pickers(printer)

    def _rebuild_filament_pickers(self, printer: PrinterMachine | None) -> None:
        for w in self._slot_pickers:
            w.deleteLater()
        self._slot_pickers.clear()
        while self._filament_layout.count() > 1:
            item = self._filament_layout.takeAt(1)
            if item.widget():
                item.widget().deleteLater()

        if printer is None:
            self._filament_hint.show()
            return
        self._filament_hint.hide()
        printer.ensure_slots()
        for lf in printer.loaded_filaments:
            row = QHBoxLayout()
            label = QLabel(f"Slot {lf.slot}")
            picker = FilamentPickerWidget()
            if lf.filament_color_id:
                picker.set_value(lf.filament_color_id)
            slot = lf.slot
            picker.color_changed.connect(
                lambda fid, _hex, s=slot, pid=printer.id: self._on_filament_changed(pid, s, fid)
            )
            row.addWidget(label)
            row.addWidget(picker, 1)
            wrap = QWidget()
            wrap.setLayout(row)
            self._filament_layout.addWidget(wrap)
            self._slot_pickers.append(picker)

    def _on_filament_changed(self, printer_id: str, slot: int, filament_id: object) -> None:
        fid = filament_id if isinstance(filament_id, str) else None
        for printer in self._fleet:
            if printer.id != printer_id:
                continue
            for lf in printer.loaded_filaments:
                if lf.slot == slot:
                    lf.filament_color_id = fid
                    break
            break
        save_fleet(self._fleet)
        self._assign_panel.refresh()

    def _add_printer(self) -> None:
        presets = load_printer_presets()
        if not presets:
            return
        dlg = PrinterFleetDialog(parent=self)
        if dlg.exec() != QDialog.DialogCode.Accepted:
            return
        m = dlg.machine()
        if m:
            self._fleet.append(m)
            save_fleet(self._fleet)
            self._assign_panel.set_fleet(self._fleet)
            if self._profile_id is not None:
                ids = list(self._plan.enabled_printer_ids or [])
                ids.append(m.id)
                self._plan.enabled_printer_ids = ids
                self._assign_panel.set_enabled_printer_ids(ids)
                self._save_plan()
            self._reload_printer_table()

    def _edit_printer(self) -> None:
        if self._selected_printer_id is None:
            return
        printer = next((p for p in self._fleet if p.id == self._selected_printer_id), None)
        if not printer:
            return
        dlg = PrinterFleetDialog(printer, parent=self)
        if dlg.exec() == QDialog.DialogCode.Accepted:
            save_fleet(self._fleet)
            self._assign_panel.set_fleet(self._fleet)
            self._reload_printer_table()
            self._rebuild_filament_pickers(printer)

    def _remove_printer(self) -> None:
        if self._selected_printer_id is None:
            return
        reply = QMessageBox.question(
            self,
            "Remove printer",
            "Remove this printer from your fleet?",
            QMessageBox.Yes | QMessageBox.No,
        )
        if reply != QMessageBox.Yes:
            return
        removed_id = self._selected_printer_id
        self._fleet = [p for p in self._fleet if p.id != removed_id]
        save_fleet(self._fleet)
        self._assign_panel.set_fleet(self._fleet)
        if self._profile_id is not None:
            self._plan.enabled_printer_ids = [
                x for x in (self._plan.enabled_printer_ids or []) if x != removed_id
            ]
            layout = self._assign_panel.plate_layout()
            if layout is not None:
                layout.printers = [
                    p for p in layout.printers if p.printer_id != removed_id
                ]
            self._assign_panel.set_enabled_printer_ids(self._plan.enabled_printer_ids or [])
            self._on_plate_layout_changed()
        self._selected_printer_id = None
        self._reload_printer_table()

    def _export_3mf(self) -> None:
        printers = self._enabled_printers()
        if not printers:
            QMessageBox.warning(
                self,
                "Export 3MF",
                "Enable at least one printer and load matching filament spools.",
            )
            return
        copies = self._part_copies()
        if not copies:
            QMessageBox.warning(self, "Export 3MF", "No included parts with STLs on disk.")
            return
        plate_layout = self._assign_panel.plate_layout()
        if plate_layout is None:
            self._assign_panel.set_kit(self._merge_parts, None, use_pool_if_empty=True)
            plate_layout = self._assign_panel.plate_layout()
        plate_layouts: list | None = None
        export_warnings: list[str] = []
        if plate_layout is not None:
            prune_layout(plate_layout, copies)
            plate_layouts, export_warnings = resolve_layout_to_plates(
                plate_layout, printers, copies
            )
        total_plates = len(plate_layouts) if plate_layouts else 0
        summary = ", ".join(p.name for p in printers)
        dlg = Export3mfDialog(
            f"Printers: {summary}",
            f"{total_plates} plate(s) from saved layout.",
            parent=self,
        )
        if dlg.exec() != QDialog.DialogCode.Accepted:
            return
        layout_mode, spacing = dlg.options_kwargs()
        opts = Export3mfOptions(
            layout_mode=layout_mode,
            spacing_mm=spacing,
            enabled_printers=printers,
            plate_layouts=plate_layouts,
        )
        if export_warnings:
            QMessageBox.warning(
                self,
                "Export 3MF",
                "Export will continue with warnings:\n\n" + "\n".join(export_warnings[:10]),
            )
        self.export_3mf_requested.emit(opts)
