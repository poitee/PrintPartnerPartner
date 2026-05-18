"""Merge engine unit tests."""

from __future__ import annotations

from pathlib import Path

from print_partner.core.merge import merge_layers
from print_partner.core.scanner import ScannedPart


def _part(rel: str, slug: str, layer_path: Path | None = None) -> ScannedPart:
    return ScannedPart(
        relative_path=rel,
        filename=Path(rel).name,
        match_key=rel.lower(),
        part_slug=slug,
        role="primary",
        quantity=1,
        absolute_path=layer_path,
    )


def test_addon_adds_part():
    base = [_part("base/a.stl", "a")]
    addon = [_part("addon/b.stl", "b")]
    result = merge_layers([("base", base), ("addon", addon)])
    keys = {p.match_key for p in result.parts}
    assert "base/a.stl" in keys
    assert "addon/b.stl" in keys
    added = next(p for p in result.parts if p.match_key == "addon/b.stl")
    assert added.status == "added"


def test_addon_replaces_same_key():
    base = [_part("shared/part.stl", "part")]
    addon = [_part("shared/part.stl", "part")]
    result = merge_layers([("base", base), ("addon", addon)])
    part = next(p for p in result.parts if p.match_key == "shared/part.stl")
    assert part.status == "replaced"
    assert part.source_layer == "addon"


def test_slug_conflict():
    base = [_part("a/widget.stl", "widget")]
    addon = [_part("b/widget_alt.stl", "widget")]
    result = merge_layers([("base", base), ("addon", addon)])
    statuses = {p.status for p in result.parts}
    assert "conflict" in statuses


def test_preserves_override():
    from print_partner.core.merge import MergePart

    base = [_part("x.stl", "x")]
    existing = {
        "x.stl": MergePart(
            match_key="x.stl",
            relative_path="x.stl",
            filename="x.stl",
            source_layer="base",
            status="base",
            role="primary",
            quantity_auto=1,
            part_slug="x",
            quantity_override=5,
            notes="keep",
        )
    }
    result = merge_layers([("base", base)], existing)
    part = result.parts[0]
    assert part.quantity_override == 5
    assert part.notes == "keep"
