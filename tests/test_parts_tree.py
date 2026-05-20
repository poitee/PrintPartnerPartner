"""Parts tree model unit tests."""

from __future__ import annotations

from pathlib import Path

from print_partner.core.parts_tree import (
    build_profile_parts_tree,
    build_wizard_parts_tree,
    merge_tristates,
    prune_tree_for_filter,
    repo_name_from_source_layer,
    rollup_tristate,
    subtree_profile_part_ids,
    subtree_wizard_match_keys,
)
from print_partner.core.scanner import ScannedPart


def _row(**kwargs) -> dict:
    base = {
        "id": 1,
        "match_key": "frame/a.stl",
        "part_slug": "a",
        "filename": "a.stl",
        "relative_path": "frame/a.stl",
        "role": "primary",
        "quantity_effective": 1,
        "source_layer": "base:Micron",
        "included": True,
        "status": "base",
        "filament_display": "",
        "printed_count": 0,
    }
    base.update(kwargs)
    return base


def _part(rel: str, slug: str) -> ScannedPart:
    return ScannedPart(
        relative_path=rel,
        filename=Path(rel).name,
        match_key=rel.lower(),
        part_slug=slug,
        role="primary",
        quantity=1,
        absolute_path=Path("/"),
    )


def test_repo_name_from_source_layer():
    assert repo_name_from_source_layer("base:Micron") == "Micron"
    assert repo_name_from_source_layer("addon:Extras") == "Extras"


def test_rollup_tristate():
    assert rollup_tristate(10, 0) == "unchecked"
    assert rollup_tristate(10, 10) == "checked"
    assert rollup_tristate(10, 4) == "partial"


def test_merge_tristates():
    assert merge_tristates(["checked", "checked"]) == "checked"
    assert merge_tristates(["unchecked", "unchecked"]) == "unchecked"
    assert merge_tristates(["checked", "unchecked"]) == "partial"


def test_profile_tree_shape_multi_repo():
    rows = [
        _row(id=1, relative_path="frame/a.stl", source_layer="base:Micron"),
        _row(
            id=2,
            filename="b.stl",
            relative_path="gantry/b.stl",
            match_key="gantry/b.stl",
            source_layer="addon:Extras",
        ),
    ]
    trees = build_profile_parts_tree(rows, included_part_ids={1})
    assert len(trees) == 2
    repos = {t.repo for t in trees}
    assert repos == {"Extras", "Micron"}
    micron = next(t for t in trees if t.repo == "Micron")
    assert micron.counts.total == 1
    assert micron.counts.included == 1
    assert micron.children[0].kind == "folder"
    assert micron.children[0].children[0].kind == "part"


def test_profile_tree_filter_and_aggregates():
    rows = [
        _row(id=1, relative_path="frame/a.stl"),
        _row(id=2, filename="b.stl", relative_path="frame/b.stl", match_key="frame/b.stl"),
    ]
    trees = build_profile_parts_tree(
        rows, included_part_ids={1}, query="b.stl", hide_printed=False
    )
    assert len(trees) == 1
    repo = trees[0]
    assert repo.counts.total == 1
    folder = repo.children[0]
    assert folder.counts.total == 1
    part = folder.children[0]
    assert part.profile_row["id"] == 2


def test_profile_hide_printed():
    rows = [
        _row(id=1, printed_count=1, quantity_effective=1),
        _row(id=2, filename="b.stl", relative_path="b.stl", match_key="b.stl", printed_count=0),
    ]
    trees = build_profile_parts_tree(
        rows, included_part_ids={1, 2}, hide_printed=True
    )
    all_ids = subtree_profile_part_ids(trees)
    assert all_ids == [2]


def test_wizard_tree_subtree_keys():
    parts = [_part("frame/a.stl", "a"), _part("gantry/b.stl", "b")]
    trees = build_wizard_parts_tree(parts, included_match_keys={"frame/a.stl"})
    assert len(trees) == 1
    repo = trees[0]
    keys = subtree_wizard_match_keys(repo)
    assert set(keys) == {"frame/a.stl", "gantry/b.stl"}


def test_prune_tree_for_filter():
    rows = [
        _row(id=1, relative_path="frame/a.stl"),
        _row(id=2, filename="z.stl", relative_path="other/z.stl", match_key="other/z.stl"),
    ]
    trees = build_profile_parts_tree(rows, included_part_ids={1, 2})
    pruned = prune_tree_for_filter(trees, "z.stl")
    ids = subtree_profile_part_ids(pruned)
    assert ids == [2]
