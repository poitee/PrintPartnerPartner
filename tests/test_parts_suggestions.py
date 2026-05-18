"""Parts suggestion engine tests."""

from pathlib import Path

from print_partner.core.parts_suggestions import build_suggestions
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


def test_mirror_exclude_when_base_excluded():
    current = [_part("shared/part.stl", "part")]
    included = {"shared/part.stl"}
    base = [_part("shared/part.stl", "part")]
    refs = [("base:kit", base, set())]
    suggestions = build_suggestions(current, included, reference_layers=refs, fuzzy_threshold=85)
    assert any(s.action == "exclude" for s in suggestions)


def test_include_mirror_when_base_included():
    current = [_part("shared/part.stl", "part")]
    included: set[str] = set()
    base = [_part("shared/part.stl", "part")]
    refs = [("base:kit", base, {"shared/part.stl"})]
    suggestions = build_suggestions(current, included, reference_layers=refs, fuzzy_threshold=85)
    assert any(s.action == "include" for s in suggestions)
