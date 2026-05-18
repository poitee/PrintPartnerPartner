"""Group, sort, and filter scanned parts for curation UI."""

from __future__ import annotations

from pathlib import Path

from print_partner.core.scanner import ScannedPart

ROOT_FOLDER = "(root)"


def folder_key_from_relative_path(relative_path: str) -> str:
    parent = str(Path(relative_path).parent).replace("\\", "/")
    if not parent or parent == ".":
        return ROOT_FOLDER
    return parent


def folder_key(part: ScannedPart) -> str:
    return folder_key_from_relative_path(part.relative_path)


def group_by_folder(parts: list[ScannedPart]) -> dict[str, list[ScannedPart]]:
    grouped: dict[str, list[ScannedPart]] = {}
    for part in parts:
        grouped.setdefault(folder_key(part), []).append(part)
    return grouped


def folder_scan_order(parts: list[ScannedPart]) -> list[str]:
    seen: list[str] = []
    for part in parts:
        key = folder_key(part)
        if key not in seen:
            seen.append(key)
    return seen


def order_folders(
    keys: list[str],
    *,
    sort_by_name: bool,
    pinned_folders: list[str],
    scan_order: list[str] | None = None,
) -> list[str]:
    unique = list(dict.fromkeys(keys))
    pinned_set = set(pinned_folders)
    pinned = [f for f in pinned_folders if f in unique]
    rest = [f for f in unique if f not in pinned_set]
    if sort_by_name:
        rest.sort(key=str.lower)
    elif scan_order:
        order_index = {k: i for i, k in enumerate(scan_order)}
        rest.sort(key=lambda k: order_index.get(k, 9999))
    else:
        rest.sort(key=str.lower)
    return pinned + rest


def sort_parts(
    parts: list[ScannedPart],
    *,
    sort_by_name: bool,
    scan_order: dict[str, int] | None = None,
) -> list[ScannedPart]:
    if sort_by_name:
        return sorted(parts, key=lambda p: p.filename.lower())
    if scan_order:
        return sorted(parts, key=lambda p: scan_order.get(p.match_key, 9999))
    return list(parts)


def part_matches_query(part: ScannedPart, folder: str, query: str) -> bool:
    q = query.strip().lower()
    if not q:
        return True
    haystacks = [
        part.filename.lower(),
        part.relative_path.lower(),
        folder.lower(),
        part.role.lower(),
        part.part_slug.lower(),
    ]
    return any(q in h for h in haystacks)


def filter_parts(parts: list[ScannedPart], query: str) -> list[ScannedPart]:
    q = query.strip()
    if not q:
        return list(parts)
    return [p for p in parts if part_matches_query(p, folder_key(p), q)]


def match_keys_for_parts(parts: list[ScannedPart]) -> set[str]:
    return {p.match_key for p in parts}


def apply_bulk_include(included: set[str], keys: set[str]) -> None:
    included.update(keys)


def apply_bulk_exclude(included: set[str], keys: set[str]) -> None:
    included.difference_update(keys)
