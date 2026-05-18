"""Regression: inclusion must not drop parts hidden by UI filters."""

from __future__ import annotations


def simulate_persist_inclusion(
    all_part_ids: set[int],
    db_included: set[int],
    panel_part_ids: set[int],
    panel_included_ids: set[int],
) -> dict[int, bool]:
    """Mirror ProfileComposer._on_parts_inclusion_changed."""
    result: dict[int, bool] = {}
    for pid in all_part_ids:
        result[pid] = pid in panel_included_ids
    return result


def test_filtered_panel_drops_hidden_inclusion_on_save():
    """Loading only filtered parts into the panel loses hidden included IDs."""
    all_ids = {1, 2, 3}
    db_included = {1, 2, 3}
    filtered_only = {1}
    panel_included = {pid for pid in filtered_only if pid in db_included}
    after = simulate_persist_inclusion(all_ids, db_included, filtered_only, panel_included)
    assert after[2] is False
    assert after[3] is False


def test_full_panel_preserves_hidden_inclusion_on_save():
    """All profile parts in the panel keep hidden rows' inclusion."""
    all_ids = {1, 2, 3}
    db_included = {1, 2, 3}
    panel_included = set(db_included)
    after = simulate_persist_inclusion(all_ids, db_included, all_ids, panel_included)
    assert after[2] is True
    assert after[3] is True
