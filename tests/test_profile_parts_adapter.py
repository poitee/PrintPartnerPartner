"""Profile parts UI uses dict snapshots, not detached ORM rows."""

from __future__ import annotations

from print_partner.core.profile_parts_adapter import display_dict_to_scanned, filter_profile_dicts


def _row(**kwargs) -> dict:
    base = {
        "id": 1,
        "match_key": "parts/a.stl",
        "part_slug": "a",
        "filename": "a.stl",
        "relative_path": "parts/a.stl",
        "role": "primary",
        "quantity_effective": 1,
        "source_layer": "base:kit",
        "included": True,
        "status": "base",
        "filament_display": "",
    }
    base.update(kwargs)
    return base


def test_display_dict_to_scanned():
    s = display_dict_to_scanned(_row())
    assert s.filename == "a.stl"
    assert s.match_key == "parts/a.stl"


def test_filter_profile_dicts_by_filename():
    rows = [_row(), _row(id=2, filename="b.stl", relative_path="b.stl", match_key="b.stl")]
    assert len(filter_profile_dicts(rows, "b.stl")) == 1
