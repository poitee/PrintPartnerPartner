"""Unprinted parts/units for checkoff → Print tab and 3MF export."""

from __future__ import annotations

from print_partner.core.filament_assigner import PartCopy
from print_partner.core.merge import MergePart
from print_partner.core.plate_plan import KitPlateLayout, layout_with_pool
from print_partner.core.print_checklist import is_fully_printed, quantity_effective
from print_partner.core.print_plan import load_kit_print_plan, save_kit_print_plan


def unprinted_copies(
    merge_parts: list[MergePart],
    completed_by_match_key: dict[str, list[bool]],
) -> list[PartCopy]:
    """Part copies that are included, have STL paths, and are not yet printed."""
    copies: list[PartCopy] = []
    for part in merge_parts:
        if not part.included:
            continue
        if not part.absolute_path or not part.absolute_path.is_file():
            continue
        qty = max(1, part.quantity_effective)
        units = completed_by_match_key.get(part.match_key)
        if units is None:
            units = [False] * qty
        for unit in range(1, qty + 1):
            idx = unit - 1
            if idx < len(units) and units[idx]:
                continue
            copies.append(PartCopy(part=part, unit=unit))
    return copies


def count_unprinted_units(
    rows: list[dict],
    *,
    included_only: bool = True,
) -> int:
    """Count unit slots not yet marked printed (for status labels)."""
    from print_partner.core.print_checklist import filter_print_checklist_rows

    pool = filter_print_checklist_rows(rows) if included_only else list(rows)
    total = 0
    unprinted = 0
    for row in pool:
        qty = quantity_effective(row)
        printed = int(row.get("printed_count", 0))
        total += qty
        unprinted += max(0, qty - min(printed, qty))
    return unprinted


def prepare_print_plan_for_missing(
    profile_id: int,
    merge_parts: list[MergePart],
    completed_by_match_key: dict[str, list[bool]],
) -> tuple[int, KitPlateLayout | None]:
    """
    Put only unprinted copies in the print-plan pool (saved to DB).
    Returns (copy_count, layout).
    """
    copies = unprinted_copies(merge_parts, completed_by_match_key)
    if not copies:
        return 0, None
    layout = layout_with_pool(copies)
    plan = load_kit_print_plan(profile_id)
    plan.plate_layout = layout
    save_kit_print_plan(profile_id, plan)
    return len(copies), layout


def filter_checkoff_display_rows(rows: list[dict], mode: str) -> list[dict]:
    """Filter included checklist rows: all | missing | done."""
    from print_partner.core.print_checklist import filter_print_checklist_rows

    included = filter_print_checklist_rows(rows)
    if mode == "missing":
        return [r for r in included if not is_fully_printed(r)]
    if mode == "done":
        return [r for r in included if is_fully_printed(r)]
    return included
