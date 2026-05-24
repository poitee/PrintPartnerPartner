"""Tests for plate preview grouping."""

from __future__ import annotations

from print_partner.core.filament_assigner import PartCopy
from print_partner.core.merge import MergePart
from print_partner.core.plate_packer import PlacedItem
from print_partner.core.plate_preview import group_plate_items_by_source


def _part(filename: str, source: str, relative_path: str | None = None) -> MergePart:
    return MergePart(
        match_key=filename,
        relative_path=relative_path or f"STLs/{filename}",
        filename=filename,
        source_layer=source,
        status="base",
        role="primary",
        quantity_auto=1,
        part_slug=filename,
        included=True,
    )


def test_group_plate_items_by_source_repo_and_folder():
    items = [
        PlacedItem(
            copy=PartCopy(part=_part("a.stl", "base:RepoA"), unit=1),
            mesh=None,  # type: ignore[arg-type]
            x_mm=0,
            y_mm=0,
            width_mm=10,
            depth_mm=10,
            height_mm=10,
        ),
        PlacedItem(
            copy=PartCopy(part=_part("b.stl", "addon:RepoB"), unit=1),
            mesh=None,  # type: ignore[arg-type]
            x_mm=0,
            y_mm=0,
            width_mm=10,
            depth_mm=10,
            height_mm=10,
        ),
        PlacedItem(
            copy=PartCopy(
                part=_part("c.stl", "base:RepoA", relative_path="Electronics/c.stl"),
                unit=1,
            ),
            mesh=None,  # type: ignore[arg-type]
            x_mm=0,
            y_mm=0,
            width_mm=10,
            depth_mm=10,
            height_mm=10,
        ),
    ]
    groups = group_plate_items_by_source(items)
    assert len(groups) == 3
    keys = {(g.repo, g.folder) for g in groups}
    assert ("RepoA", "STLs") in keys
    assert ("RepoA", "Electronics") in keys
    assert ("RepoB", "STLs") in keys
