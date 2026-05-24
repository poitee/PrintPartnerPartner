"""Add/edit printers in the global fleet."""

from __future__ import annotations

from PySide6.QtWidgets import (
    QComboBox,
    QDialog,
    QDialogButtonBox,
    QDoubleSpinBox,
    QFormLayout,
    QHBoxLayout,
    QLineEdit,
    QSpinBox,
    QVBoxLayout,
)

from print_partner.core.printer_fleet import PrinterMachine, load_printer_presets


class PrinterFleetDialog(QDialog):
    """Create or edit one printer machine."""

    def __init__(self, machine: PrinterMachine | None = None, parent=None) -> None:
        super().__init__(parent)
        self.setWindowTitle("Printer" if machine else "Add printer")
        self.resize(400, 280)
        self._machine = machine
        self._result_machine: PrinterMachine | None = None

        root = QVBoxLayout(self)
        form = QFormLayout()

        self.preset = QComboBox()
        for p in load_printer_presets():
            self.preset.addItem(
                f"{p.name} ({p.bed_width_mm:.0f}×{p.bed_depth_mm:.0f} mm)", p.id
            )
        self.preset.currentIndexChanged.connect(self._on_preset)
        form.addRow("From preset", self.preset)

        self.name_edit = QLineEdit()
        form.addRow("Name", self.name_edit)

        self.bed_w = QDoubleSpinBox()
        self.bed_w.setRange(50, 1000)
        self.bed_w.setSuffix(" mm")
        self.bed_d = QDoubleSpinBox()
        self.bed_d.setRange(50, 1000)
        self.bed_d.setSuffix(" mm")
        self.bed_h = QDoubleSpinBox()
        self.bed_h.setRange(50, 1000)
        self.bed_h.setSuffix(" mm")
        bed_row = QHBoxLayout()
        bed_row.addWidget(self.bed_w)
        bed_row.addWidget(self.bed_d)
        bed_row.addWidget(self.bed_h)
        form.addRow("Bed X / Y / Z", bed_row)

        self.slots = QSpinBox()
        self.slots.setRange(1, 4)
        form.addRow("Filament slots", self.slots)

        self.margin = QDoubleSpinBox()
        self.margin.setRange(0, 30)
        self.margin.setValue(4.0)
        self.margin.setSuffix(" mm")
        form.addRow("Margin", self.margin)

        root.addLayout(form)

        buttons = QDialogButtonBox(QDialogButtonBox.Ok | QDialogButtonBox.Cancel)
        buttons.accepted.connect(self._accept)
        buttons.rejected.connect(self.reject)
        root.addWidget(buttons)

        if machine:
            self.preset.setEnabled(False)
            self._load_machine(machine)
        else:
            self._on_preset()

    def _on_preset(self) -> None:
        if self._machine:
            return
        preset_id = self.preset.currentData()
        for p in load_printer_presets():
            if p.id == preset_id:
                self.name_edit.setText(p.name)
                self.bed_w.setValue(p.bed_width_mm)
                self.bed_d.setValue(p.bed_depth_mm)
                self.bed_h.setValue(p.bed_height_mm or 250)
                self.slots.setValue(p.max_filament_slots)
                break

    def _load_machine(self, m: PrinterMachine) -> None:
        self.name_edit.setText(m.name)
        self.bed_w.setValue(m.bed_width_mm)
        self.bed_d.setValue(m.bed_depth_mm)
        self.bed_h.setValue(m.bed_height_mm or 250)
        self.slots.setValue(m.max_filament_slots)
        self.margin.setValue(m.margin_mm)

    def _accept(self) -> None:
        name = self.name_edit.text().strip()
        if not name:
            return
        if self._machine:
            m = self._machine
        else:
            from print_partner.core.printer_fleet import new_machine_from_preset

            preset = load_printer_presets()[self.preset.currentIndex()]
            m = new_machine_from_preset(preset, name)
        m.name = name
        m.bed_width_mm = self.bed_w.value()
        m.bed_depth_mm = self.bed_d.value()
        m.bed_height_mm = self.bed_h.value()
        m.max_filament_slots = self.slots.value()
        m.margin_mm = self.margin.value()
        m.ensure_slots()
        self._result_machine = m
        self.accept()

    def machine(self) -> PrinterMachine | None:
        return self._result_machine
