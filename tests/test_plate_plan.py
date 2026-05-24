"""Tests for persisted plate layout."""

from __future__ import annotations

from pathlib import Path

from print_partner.core.filament_assigner import PartCopy
from print_partner.core.merge import MergePart
from print_partner.core.plate_plan import (
    CopyRef,
    KitPlateLayout,
    PrinterPlatePlan,
    add_empty_plate,
    auto_plate_layout,
    move_copy,
    move_within_plate,
    remove_plate,
)
from print_partner.core.plate_packer import pack_copies_on_printer, pack_single_plate
from print_partner.core.printer_fleet import PrinterMachine


def _minimal_stl(path: Path) -> None:
    path.write_bytes(
        b"""solid t
  facet normal 0 0 1
    outer loop
      vertex 0 0 0
      vertex 30 0 0
      vertex 0 20 0
    endloop
  endfacet
endsolid t
"""
    )


def _part(path: Path, key: str) -> MergePart:
    return MergePart(
        match_key=key,
        relative_path=f"{key}.stl",
        filename=f"{key}.stl",
        source_layer="base:RepoA",
        status="base",
        role="primary",
        quantity_auto=1,
        part_slug=key,
        included=True,
        absolute_path=path,
    )


def test_auto_and_move_between_plates(tmp_path: Path):
    stl = tmp_path / "a.stl"
    _minimal_stl(stl)
    part = _part(stl, "a")
    printer = PrinterMachine(id="p1", name="P1", bed_width_mm=200, bed_depth_mm=200)
    copies = [PartCopy(part, 1)]
    layout, _ = auto_plate_layout([printer], copies, spacing_mm=4.0)
    assert len(layout.printers) == 1
    assert len(layout.printers[0].plates) == 1
    add_empty_plate(layout, "p1")
    ref = CopyRef.from_copy(copies[0])
    move_copy(layout, ref, printer_id="p1", plate_index=2)
    assert len(layout.printers[0].plates) == 2
    assert ref in layout.printers[0].plates[1]


def test_pack_single_plate_warns_on_overflow(tmp_path: Path):
    stl = tmp_path / "big.stl"
    _minimal_stl(stl)
    part = _part(stl, "b")
    printer = PrinterMachine(id="p1", name="Tiny", bed_width_mm=40, bed_depth_mm=40, margin_mm=2)
    copies = [PartCopy(part, i) for i in range(1, 4)]
    plate, warnings = pack_single_plate(printer, copies, plate_index=1, spacing_mm=2)
    assert plate is not None
    plates_auto, _ = pack_copies_on_printer(printer, copies, spacing_mm=2)
    if len(plates_auto) > 1:
        assert any("may not fit" in w for w in warnings)


def test_move_within_plate() -> None:
    ref1 = CopyRef("a", 1)
    ref2 = CopyRef("b", 1)
    layout = KitPlateLayout(
        spacing_mm=4.0,
        printers=[PrinterPlatePlan(printer_id="p1", plates=[[ref1, ref2]])],
    )
    assert move_within_plate(layout, ref2, "p1", 1, -1)
    assert layout.printers[0].plates[0][0] == ref2


def test_remove_plate_moves_to_unassigned(tmp_path: Path) -> None:
    stl = tmp_path / "a.stl"
    _minimal_stl(stl)
    ref = CopyRef.from_copy(PartCopy(_part(stl, "a"), 1))
    layout = KitPlateLayout(
        spacing_mm=4.0,
        printers=[PrinterPlatePlan(printer_id="p1", plates=[[ref]], unassigned=[])],
    )
    assert remove_plate(layout, "p1", 1)
    assert layout.printers[0].plates == []
    assert ref in layout.printers[0].unassigned
