"""Adapt profile part display dicts for folder-section curation UI."""

from __future__ import annotations

from pathlib import Path

from print_partner.core.parts_grouping import folder_key_from_relative_path, part_matches_query
from print_partner.core.scanner import ScannedPart


def display_dict_to_scanned(row: dict) -> ScannedPart:
    """Convert part_to_display_dict row to ScannedPart for grouping/sort helpers."""
    rel = row["relative_path"]
    return ScannedPart(
        relative_path=rel,
        filename=row["filename"],
        match_key=row["match_key"],
        part_slug=row.get("part_slug") or Path(rel).stem,
        role=row["role"],
        quantity=int(row["quantity_effective"]),
        absolute_path=Path("/"),
    )


def filter_profile_dicts(rows: list[dict], query: str) -> list[dict]:
    q = query.strip()
    if not q:
        return list(rows)
    ql = q.lower()
    result: list[dict] = []
    for row in rows:
        scanned = display_dict_to_scanned(row)
        folder = folder_key_from_relative_path(row["relative_path"])
        if part_matches_query(scanned, folder, q):
            result.append(row)
            continue
        extra = (
            row.get("source_layer", ""),
            row.get("filament_display", ""),
        )
        if any(ql in text.lower() for text in extra if text):
            result.append(row)
    return result
