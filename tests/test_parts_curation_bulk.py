"""Bulk include/exclude targeting for filtered parts."""

from pathlib import Path

from print_partner.core.parts_grouping import (
    apply_bulk_exclude,
    apply_bulk_include,
    filter_parts,
    match_keys_for_parts,
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


def test_bulk_include_only_affects_filtered_keys():
    parts = [_part("frame/a.stl", "a"), _part("gantry/b.stl", "b")]
    visible = filter_parts(parts, "gantry")
    included: set[str] = set()
    apply_bulk_include(included, match_keys_for_parts(visible))
    assert "gantry/b.stl" in included
    assert "frame/a.stl" not in included


def test_bulk_exclude_only_affects_filtered_keys():
    parts = [_part("frame/a.stl", "a"), _part("gantry/b.stl", "b")]
    included = {p.match_key for p in parts}
    visible = filter_parts(parts, "gantry")
    apply_bulk_exclude(included, match_keys_for_parts(visible))
    assert "gantry/b.stl" not in included
    assert "frame/a.stl" in included


def test_empty_filter_includes_all_keys():
    parts = [_part("a.stl", "a"), _part("b.stl", "b")]
    visible = filter_parts(parts, "")
    assert match_keys_for_parts(visible) == {"a.stl", "b.stl"}
