"""README hint parser tests."""

from pathlib import Path

from print_partner.core.readme_hints import parse_readme_hints
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


def test_readme_checklist_and_optional():
    text = Path(__file__).parent.joinpath("fixtures/readme_kit.md").read_text(encoding="utf-8")
    parts = [
        _part("frame/widget.stl", "widget"),
        _part("frame/bracket.stl", "bracket"),
        _part("extras/spare_clip.stl", "spare_clip"),
        _part("gantry/rail.stl", "rail"),
    ]
    hints = parse_readme_hints(text, parts, "README.md")
    actions = {(h.match_key, h.action) for h in hints}
    assert ("frame/widget.stl", "include") in actions
    assert ("extras/spare_clip.stl", "exclude") in actions
