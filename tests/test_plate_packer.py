"""Tests for plate bin packing."""

from __future__ import annotations

from pathlib import Path

from print_partner.core.filament_assigner import PartCopy
from print_partner.core.merge import MergePart
from print_partner.core.plate_packer import pack_copies_on_printer
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


def test_pack_fits_one_plate(tmp_path: Path):
    stl = tmp_path / "a.stl"
    _minimal_stl(stl)
    part = MergePart(
        match_key="a",
        relative_path="a.stl",
        filename="a.stl",
        source_layer="base",
        status="base",
        role="primary",
        quantity_auto=1,
        part_slug="a",
        included=True,
        absolute_path=stl,
    )
    printer = PrinterMachine(
        id="p1",
        name="Test",
        bed_width_mm=100,
        bed_depth_mm=100,
    )
    plates, warnings = pack_copies_on_printer(printer, [PartCopy(part, 1)])
    assert not warnings
    assert len(plates) == 1
    assert len(plates[0].items) == 1


def test_pack_overflow_second_plate(tmp_path: Path):
    stl = tmp_path / "big.stl"
    _minimal_stl(stl)
    part = MergePart(
        match_key="b",
        relative_path="big.stl",
        filename="big.stl",
        source_layer="base",
        status="base",
        role="primary",
        quantity_auto=1,
        part_slug="b",
        included=True,
        absolute_path=stl,
    )
    printer = PrinterMachine(
        id="p1",
        name="Tiny",
        bed_width_mm=40,
        bed_depth_mm=40,
        margin_mm=2,
    )
    copies = [PartCopy(part, i) for i in range(1, 4)]
    plates, _warnings = pack_copies_on_printer(printer, copies, spacing_mm=2)
    assert len(plates) >= 2
