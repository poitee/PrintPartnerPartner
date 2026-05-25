"""Shared QTableWidget column sizing for readable, expanding layouts."""

from __future__ import annotations

from PySide6.QtCore import Qt
from PySide6.QtWidgets import QHeaderView, QTableWidget


def configure_table_columns(
    table: QTableWidget,
    *,
    stretch_columns: tuple[int, ...] = (0,),
    fixed_widths: dict[int, int] | None = None,
    min_stretch_width: int = 120,
) -> None:
    """Apply palette-friendly defaults and resize modes."""
    table.setWordWrap(True)
    table.setTextElideMode(Qt.TextElideMode.ElideNone)
    table.setAlternatingRowColors(True)
    table.horizontalHeader().setStretchLastSection(False)
    table.verticalHeader().setDefaultSectionSize(28)
    fixed_widths = fixed_widths or {}
    for col in range(table.columnCount()):
        if col in stretch_columns:
            table.horizontalHeader().setSectionResizeMode(
                col, QHeaderView.ResizeMode.Stretch
            )
            if table.columnWidth(col) < min_stretch_width:
                table.setColumnWidth(col, min_stretch_width)
        elif col in fixed_widths:
            table.horizontalHeader().setSectionResizeMode(
                col, QHeaderView.ResizeMode.Fixed
            )
            table.setColumnWidth(col, fixed_widths[col])
        else:
            table.horizontalHeader().setSectionResizeMode(
                col, QHeaderView.ResizeMode.ResizeToContents
            )
