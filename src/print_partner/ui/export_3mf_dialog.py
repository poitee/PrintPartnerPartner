"""Export 3MF options dialog (layout mode; printers from Print tab)."""

from __future__ import annotations

from PySide6.QtWidgets import (
    QComboBox,
    QDialog,
    QDialogButtonBox,
    QDoubleSpinBox,
    QFormLayout,
    QLabel,
    QVBoxLayout,
)

from print_partner.core.export_3mf import Export3mfOptions, ExportLayoutMode


class Export3mfDialog(QDialog):
    def __init__(self, printer_summary: str, plate_hint: str, parent=None) -> None:
        super().__init__(parent)
        self.setWindowTitle("Export 3MF")
        self.resize(440, 220)

        root = QVBoxLayout(self)
        summary = QLabel(printer_summary)
        summary.setWordWrap(True)
        root.addWidget(summary)
        hint = QLabel(plate_hint)
        hint.setProperty("muted", True)
        hint.setWordWrap(True)
        root.addWidget(hint)

        form = QFormLayout()
        self.layout_mode = QComboBox()
        self.layout_mode.addItem("One file per plate (recommended)", "per_plate")
        self.layout_mode.addItem("Zip of all plates + manifest", "zip")
        self.layout_mode.addItem("Single file — plates spaced apart", "single_offset")
        self.layout_mode.addItem("Single plate only (must fit one bed)", "single_plate_only")
        form.addRow("Layout", self.layout_mode)

        self.spacing = QDoubleSpinBox()
        self.spacing.setRange(1.0, 50.0)
        self.spacing.setValue(4.0)
        self.spacing.setSuffix(" mm")
        form.addRow("Part spacing", self.spacing)
        root.addLayout(form)

        buttons = QDialogButtonBox(QDialogButtonBox.Ok | QDialogButtonBox.Cancel)
        buttons.accepted.connect(self.accept)
        buttons.rejected.connect(self.reject)
        root.addWidget(buttons)

    def options_kwargs(self) -> tuple[ExportLayoutMode, float]:
        mode = self.layout_mode.currentData()
        return mode, float(self.spacing.value())
