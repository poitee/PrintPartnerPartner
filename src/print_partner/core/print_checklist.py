"""Grouping and filters for in-app checkoff checklist (Checkoff tab)."""

from __future__ import annotations

from dataclasses import dataclass, field

from print_partner.core.export_html import _repo_sort_key
from print_partner.core.part_paths import ProfileStlIndex
from print_partner.core.parts_grouping import folder_key_from_relative_path


def quantity_effective(row: dict) -> int:
    return max(1, int(row.get("quantity_effective", 1)))


def is_fully_printed(row: dict) -> bool:
    qty = quantity_effective(row)
    printed = int(row.get("printed_count", 0))
    return printed >= qty


def filter_print_checklist_rows(rows: list[dict]) -> list[dict]:
    """Included parts for the Checkoff tab checklist."""
    return [r for r in rows if r.get("included")]


filter_included_rows = filter_print_checklist_rows


def progress_summary(rows: list[dict], *, included_only: bool = True) -> str:
    """Human-readable printed progress for included parts."""
    pool = filter_print_checklist_rows(rows) if included_only else list(rows)
    if not pool:
        return "0/0 parts fully printed · 0/0 units"
    parts_done = sum(1 for r in pool if is_fully_printed(r))
    total_units = sum(quantity_effective(r) for r in pool)
    printed_units = sum(int(r.get("printed_count", 0)) for r in pool)
    return (
        f"{parts_done}/{len(pool)} parts fully printed · "
        f"{printed_units}/{total_units} units"
    )


@dataclass
class ChecklistPartRow:
    id: int
    filename: str
    role: str
    relative_path: str
    source_layer: str
    quantity: int
    printed_count: int
    filament_display: str
    filament_hex: str | None
    all_printed: bool
    notes: str = ""
    thumbnail_path: str | None = None


@dataclass
class ChecklistFolderSection:
    label: str
    parts: list[ChecklistPartRow] = field(default_factory=list)


@dataclass
class ChecklistRepoSection:
    label: str
    folders: list[ChecklistFolderSection] = field(default_factory=list)

    @property
    def part_count(self) -> int:
        return sum(len(f.parts) for f in self.folders)


def _row_to_checklist_part(row: dict) -> ChecklistPartRow:
    qty = quantity_effective(row)
    printed = int(row.get("printed_count", 0))
    return ChecklistPartRow(
        id=int(row["id"]),
        filename=str(row.get("filename", "")),
        role=str(row.get("role", "")),
        relative_path=str(row.get("relative_path", "")),
        source_layer=str(row.get("source_layer", "unknown")),
        quantity=qty,
        printed_count=printed,
        filament_display=str(row.get("filament_display") or ""),
        filament_hex=row.get("filament_hex"),
        all_printed=printed >= qty,
        notes=str(row.get("notes") or ""),
        thumbnail_path=row.get("thumbnail_path"),
    )


def enrich_thumbnail_paths(part_dicts: list[dict], parts: list, index: ProfileStlIndex) -> None:
    """Attach thumbnail_path to display dicts from the global thumb cache."""
    from print_partner.core.part_paths import resolve_part_stl_path_indexed
    from print_partner.core.thumbnails import global_thumbnail_path

    for row, part in zip(part_dicts, parts):
        stl = resolve_part_stl_path_indexed(part, index)
        if stl and stl.is_file():
            thumb = global_thumbnail_path(stl, part.role, row.get("filament_hex"))
            row["thumbnail_path"] = str(thumb) if thumb.is_file() else None
        else:
            row["thumbnail_path"] = None


def filaments_used_from_rows(rows: list[dict]) -> list[dict]:
    """Unique filament labels for included parts (matches HTML export block)."""
    seen: dict[str, dict] = {}
    for row in filter_print_checklist_rows(rows):
        label = str(row.get("filament_display") or "").strip()
        if not label:
            continue
        key = label.lower()
        if key not in seen:
            seen[key] = {"label": label, "hex": row.get("filament_hex")}
    return sorted(seen.values(), key=lambda x: str(x["label"]).lower())


def group_checklist_rows(rows: list[dict]) -> list[ChecklistRepoSection]:
    """Group display dict rows by source_layer (repo) and parent folder."""
    by_repo_folder: dict[str, dict[str, list[ChecklistPartRow]]] = {}
    for row in rows:
        if not row.get("included"):
            continue
        repo_label = row.get("source_layer") or "unknown"
        folder_label = folder_key_from_relative_path(row.get("relative_path", ""))
        by_repo_folder.setdefault(repo_label, {}).setdefault(folder_label, []).append(
            _row_to_checklist_part(row)
        )

    sections: list[ChecklistRepoSection] = []
    for repo_label in sorted(by_repo_folder.keys(), key=_repo_sort_key):
        folders_map = by_repo_folder[repo_label]
        folder_sections: list[ChecklistFolderSection] = []
        for folder_label in sorted(folders_map.keys(), key=str.lower):
            parts_rows = sorted(folders_map[folder_label], key=lambda p: p.filename.lower())
            folder_sections.append(ChecklistFolderSection(label=folder_label, parts=parts_rows))
        sections.append(
            ChecklistRepoSection(label=repo_label, folders=folder_sections)
        )
    return sections
