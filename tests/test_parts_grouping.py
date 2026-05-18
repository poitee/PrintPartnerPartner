"""Parts grouping unit tests."""

from pathlib import Path

from print_partner.core.parts_grouping import (
    ROOT_FOLDER,
    filter_parts,
    folder_key,
    folder_key_from_relative_path,
    folder_scan_order,
    group_by_folder,
    order_folders,
    sort_parts,
)
from print_partner.core.scanner import ScannedPart


def _part(rel: str, slug: str) -> ScannedPart:
    return ScannedPart(
        relative_path=rel,
        filename=Path(rel).name,
        match_key=rel.lower(),
        part_slug=slug,
        role="primary",
        quantity=1,
        absolute_path=None,
    )


def test_folder_key_root():
    assert folder_key(_part("widget.stl", "widget")) == ROOT_FOLDER
    assert folder_key(_part("frame/widget.stl", "widget")) == "frame"
    assert folder_key_from_relative_path("widget.stl") == ROOT_FOLDER
    assert folder_key_from_relative_path("frame/widget.stl") == "frame"


def test_order_folders_pinned_first():
    keys = ["b", "a", "c"]
    ordered = order_folders(keys, sort_by_name=True, pinned_folders=["c"])
    assert ordered[0] == "c"
    assert ordered[1:] == ["a", "b"]


def test_filter_parts_by_filename():
    parts = [_part("frame/a.stl", "a"), _part("gantry/b.stl", "b")]
    assert len(filter_parts(parts, "gantry")) == 1
    assert filter_parts(parts, "") == parts


def test_sort_parts_by_name():
    parts = [_part("z.stl", "z"), _part("a.stl", "a")]
    sorted_parts = sort_parts(parts, sort_by_name=True, scan_order=None)
    assert sorted_parts[0].filename == "a.stl"
