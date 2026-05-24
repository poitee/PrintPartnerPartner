"""Tests for print plan filament / source grouping."""

from pathlib import Path

from print_partner.core.filament_assigner import PartCopy
from print_partner.core.merge import MergePart
from print_partner.core.print_plan_grouping import build_print_plan_groups, part_filament_label
from print_partner.core.printer_fleet import LoadedFilament, PrinterMachine


def _part(
    *,
    match_key: str = "a",
    filename: str = "a.stl",
    source_layer: str = "base:proj",
    relative_path: str = "parts/a.stl",
    filament_color_id: str | None = "fid-red",
    filament_display: str = "PLA · Red",
    filament_hex: str | None = "#ff0000",
) -> MergePart:
    return MergePart(
        match_key=match_key,
        relative_path=relative_path,
        filename=filename,
        source_layer=source_layer,
        status="base",
        role="primary",
        quantity_auto=1,
        part_slug="a",
        included=True,
        absolute_path=Path("/tmp/a.stl"),
        filament_color_id=filament_color_id,
        filament_display=filament_display,
        filament_hex=filament_hex,
    )


def test_groups_by_filament_then_repo_folder():
    p1 = _part(match_key="k1", filename="one.stl", relative_path="parts/one.stl")
    p2 = _part(
        match_key="k2",
        filename="two.stl",
        relative_path="hardware/two.stl",
        filament_color_id="fid-blue",
        filament_display="PETG · Blue",
        filament_hex="#0000ff",
    )
    copies = [PartCopy(part=p1, unit=1), PartCopy(part=p2, unit=1)]
    printer = PrinterMachine(
        id="p1",
        name="X1",
        bed_width_mm=256,
        bed_depth_mm=256,
        loaded_filaments=[LoadedFilament(slot=1, filament_color_id="fid-red")],
    )
    groups, _warnings = build_print_plan_groups(copies, [printer])
    assert len(groups) == 2
    by_label = {g.filament_label: g for g in groups}
    red = by_label["PLA · Red"]
    assert len(red.sources) == 1
    assert red.sources[0].lines[0].label.endswith("one.stl")
    assert red.printer_name == "X1"
    blue = by_label["PETG · Blue"]
    assert blue.warning is not None


def test_unset_filament_warning():
    part = _part(filament_color_id=None, filament_display="", filament_hex=None)
    groups, _ = build_print_plan_groups([PartCopy(part=part, unit=1)], [])
    assert groups[0].filament_key == "__unset__"
    assert groups[0].warning is not None
    assert "Compose" in groups[0].warning
    assert part_filament_label(part) == "(filament not set — primary)"
