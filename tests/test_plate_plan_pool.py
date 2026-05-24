"""Tests for unclassified pool and printer assignment."""

from __future__ import annotations

from pathlib import Path

from print_partner.core.filament_assigner import PartCopy
from print_partner.core.merge import MergePart
from print_partner.core.plate_plan import (
    CopyRef,
    assign_refs_to_printer,
    layout_with_pool,
    printer_assigned_refs,
    return_refs_to_pool,
)
from print_partner.core.printer_fleet import PrinterMachine


def _part(path: Path) -> MergePart:
    return MergePart(
        match_key="a",
        relative_path="a.stl",
        filename="a.stl",
        source_layer="base:Repo",
        status="base",
        role="primary",
        quantity_auto=1,
        part_slug="a",
        included=True,
        absolute_path=path,
    )


def test_pool_assign_and_return(tmp_path: Path):
    stl = tmp_path / "a.stl"
    stl.write_bytes(b"solid x\nendsolid x\n")
    copies = [PartCopy(_part(stl), 1)]
    layout = layout_with_pool(copies)
    assert len(layout.pool) == 1
    ref = layout.pool[0]
    assert assign_refs_to_printer(layout, [ref], "p1") == 1
    assert layout.pool == []
    plan = layout.printer_plan("p1")
    assert plan is not None
    assert len(printer_assigned_refs(plan)) == 1
    assigned = printer_assigned_refs(plan)[0]
    assert return_refs_to_pool(layout, [assigned]) == 1
    assert len(layout.pool) == 1
    assert printer_assigned_refs(plan) == []
