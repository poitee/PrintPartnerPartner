"""Scrollable workflow guide (F1 / Help menu)."""

from __future__ import annotations

from PySide6.QtCore import Qt
from PySide6.QtWidgets import (
    QDialog,
    QDialogButtonBox,
    QLabel,
    QScrollArea,
    QVBoxLayout,
    QWidget,
)

_GUIDE_HTML = """
<h3>Libraries → Kit → Print → Checkoff</h3>
<p><b>1 Libraries</b> (Ctrl+1) — Add or sync Git repos and local folders. Use
<b>Import files…</b> to choose which STL paths are scanned into kits.</p>
<p><b>2 Kit</b> (Ctrl+2) — Open a kit from <b>Your kits</b>, then:</p>
<ul>
<li><b>Compose</b> — Layers, Recompute, filament, parts tree, preview, docs.</li>
<li><b>Review</b> — Included parts only; uncheck Print to exclude before checkoff.</li>
</ul>
<p><b>3 Print</b> (Ctrl+3) — Enable printers, load filament spools, preview assignment,
export 3MF plates (primary export for slicer plates).</p>
<p><b>4 Checkoff</b> (Ctrl+4) — Mark printed units on the in-app checklist (progress saves per kit).
<b>Print missing →</b> sends unfinished parts to the Print tab; <b>Export missing 3MF…</b> exports
only unprinted units. <b>Export checklist</b> saves printable HTML for the shop floor.</p>
<p><b>Shortcuts:</b> Ctrl+1–4 workflow steps · F1 this guide · Ctrl+R Recompute (Kit tab)</p>
"""


class WorkflowGuideDialog(QDialog):
    def __init__(self, parent=None) -> None:
        super().__init__(parent)
        self.setWindowTitle("Workflow guide")
        self.resize(520, 420)
        root = QVBoxLayout(self)
        scroll = QScrollArea()
        scroll.setWidgetResizable(True)
        body = QWidget()
        body_layout = QVBoxLayout(body)
        label = QLabel(_GUIDE_HTML)
        label.setWordWrap(True)
        label.setTextFormat(Qt.TextFormat.RichText)
        body_layout.addWidget(label)
        scroll.setWidget(body)
        root.addWidget(scroll)
        buttons = QDialogButtonBox(QDialogButtonBox.StandardButton.Close)
        buttons.rejected.connect(self.reject)
        close_btn = buttons.button(QDialogButtonBox.StandardButton.Close)
        if close_btn is not None:
            close_btn.clicked.connect(self.accept)
        root.addWidget(buttons)
