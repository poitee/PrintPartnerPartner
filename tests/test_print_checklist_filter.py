"""Checkoff checklist filters and grouping."""

from __future__ import annotations

from print_partner.core.print_checklist import (
    filaments_used_from_rows,
    filter_included_rows,
    filter_print_checklist_rows,
    group_checklist_rows,
    is_fully_printed,
    progress_summary,
)


def _row(*, included: bool, printed: int, qty: int = 1, **extra) -> dict:
    base = {
        "id": extra.get("id", 1),
        "included": included,
        "printed_count": printed,
        "quantity_effective": qty,
        "filename": extra.get("filename", "a.stl"),
        "role": "primary",
        "relative_path": extra.get("relative_path", "a.stl"),
        "source_layer": extra.get("source_layer", "base:Repo"),
        "filament_display": "",
    }
    base.update(extra)
    return base


def test_is_fully_printed():
    assert is_fully_printed(_row(included=True, printed=1, qty=1))
    assert not is_fully_printed(_row(included=True, printed=0, qty=2))


def test_filter_print_checklist_only_included():
    rows = [
        _row(id=1, included=True, printed=0),
        _row(id=2, included=False, printed=0),
    ]
    assert len(filter_print_checklist_rows(rows)) == 1
    assert filter_print_checklist_rows(rows)[0]["id"] == 1


def test_filter_included_rows_alias():
    rows = [
        _row(id=1, included=True, printed=0),
        _row(id=2, included=False, printed=0),
    ]
    assert filter_included_rows(rows) == filter_print_checklist_rows(rows)


def test_progress_summary():
    rows = [
        _row(id=1, included=True, printed=1, qty=1),
        _row(id=2, included=True, printed=0, qty=3),
        _row(id=3, included=False, printed=99, qty=1),
    ]
    text = progress_summary(rows)
    assert "1/2 parts fully printed" in text
    assert "1/4 units" in text


def test_filaments_used_from_rows():
    rows = [
        _row(id=1, included=True, printed=0, filament_display="PLA Red"),
        _row(id=2, included=True, printed=0, filament_display="PLA Red"),
        _row(id=3, included=True, printed=0, filament_display="PETG Clear"),
        _row(id=4, included=False, printed=0, filament_display="Ignored"),
    ]
    used = filaments_used_from_rows(rows)
    assert len(used) == 2
    labels = {u["label"] for u in used}
    assert labels == {"PLA Red", "PETG Clear"}


def test_group_checklist_by_repo_and_folder():
    rows = [
        _row(
            id=1,
            included=True,
            printed=1,
            filename="z.stl",
            relative_path="frame/z.stl",
            source_layer="base:Alpha",
        ),
        _row(
            id=2,
            included=True,
            printed=0,
            filename="a.stl",
            relative_path="a.stl",
            source_layer="addon:Beta",
        ),
    ]
    sections = group_checklist_rows(rows)
    assert len(sections) == 2
    assert sections[0].label == "base:Alpha"
    assert sections[0].folders[0].parts[0].filename == "z.stl"
