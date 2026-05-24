"""Tests for filament-to-printer assignment."""

from __future__ import annotations

from print_partner.core.filament_assigner import PartCopy, assign_parts_to_printers
from print_partner.core.merge import MergePart
from print_partner.core.printer_fleet import LoadedFilament, PrinterMachine


def _part(fid: str | None, name: str = "x.stl") -> MergePart:
    return MergePart(
        match_key=name,
        relative_path=name,
        filename=name,
        source_layer="base",
        status="base",
        role="primary",
        quantity_auto=1,
        part_slug=name,
        included=True,
        filament_color_id=fid,
        filament_display=fid or "",
    )


def test_assign_by_filament_id():
    p1 = PrinterMachine(
        id="a",
        name="A",
        bed_width_mm=200,
        bed_depth_mm=200,
        loaded_filaments=[LoadedFilament(slot=1, filament_color_id="red")],
    )
    p1.ensure_slots()
    p2 = PrinterMachine(
        id="b",
        name="B",
        bed_width_mm=200,
        bed_depth_mm=200,
        loaded_filaments=[LoadedFilament(slot=1, filament_color_id="blue")],
    )
    p2.ensure_slots()
    copies = [PartCopy(_part("red", "r.stl"), 1), PartCopy(_part("blue", "b.stl"), 1)]
    by_printer, warnings = assign_parts_to_printers(copies, [p1, p2])
    assert len(by_printer["a"]) == 1
    assert len(by_printer["b"]) == 1
    assert not warnings
