"""Group kit copies by filament and source repo/folder for the Print tab."""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass, field

from print_partner.core.export_3mf import object_display_name
from print_partner.core.filament_assigner import PartCopy, assign_parts_to_printers
from print_partner.core.merge import MergePart
from print_partner.core.parts_grouping import folder_key_from_relative_path
from print_partner.core.parts_tree import repo_name_from_source_layer
from print_partner.core.printer_fleet import PrinterMachine


def part_filament_key(part: MergePart) -> str:
    if part.filament_color_id:
        return part.filament_color_id
    display = (part.filament_display or "").strip()
    if display:
        return f"display:{display}"
    return "__unset__"


def part_filament_label(part: MergePart) -> str:
    label = (part.filament_display or "").strip()
    if label:
        return label
    if part.filament_color_id:
        return part.filament_color_id
    if part.role:
        return f"(filament not set — {part.role})"
    return "(filament not set)"


@dataclass(frozen=True)
class PrintPlanPartLine:
    label: str
    count: int


@dataclass(frozen=True)
class PrintPlanSourceGroup:
    repo: str
    folder: str
    lines: list[PrintPlanPartLine] = field(default_factory=list)

    @property
    def part_count(self) -> int:
        return sum(line.count for line in self.lines)


@dataclass(frozen=True)
class PrintPlanFilamentGroup:
    filament_key: str
    filament_label: str
    filament_hex: str | None
    part_count: int
    printer_name: str | None
    sources: list[PrintPlanSourceGroup] = field(default_factory=list)
    warning: str | None = None


def build_print_plan_groups(
    copies: list[PartCopy],
    printers: list[PrinterMachine],
) -> tuple[list[PrintPlanFilamentGroup], list[str]]:
    """Filament → repo/folder → part lines, with printer assignment hints."""
    if not copies:
        return [], []

    by_printer, assign_warnings = assign_parts_to_printers(copies, printers)
    name_by_id = {p.id: p.name for p in printers}

    copy_printer: dict[tuple[str, int], str] = {}
    for printer_id, pcopies in by_printer.items():
        for copy in pcopies:
            copy_printer[(copy.part.match_key, copy.unit)] = printer_id

    filament_buckets: dict[str, list[PartCopy]] = defaultdict(list)
    for copy in copies:
        filament_buckets[part_filament_key(copy.part)].append(copy)

    groups: list[PrintPlanFilamentGroup] = []
    for key in sorted(filament_buckets.keys(), key=_filament_sort_key):
        fcopies = filament_buckets[key]
        sample = fcopies[0].part
        label = part_filament_label(sample)
        hex_color = sample.filament_hex

        printer_ids: set[str] = set()
        for copy in fcopies:
            pid = copy_printer.get((copy.part.match_key, copy.unit))
            if pid:
                printer_ids.add(pid)
        if len(printer_ids) == 1:
            printer_name = name_by_id.get(next(iter(printer_ids)))
        elif len(printer_ids) > 1:
            printer_name = ", ".join(sorted(name_by_id.get(pid, pid) for pid in printer_ids))
        else:
            printer_name = None

        warning: str | None = None
        if key == "__unset__":
            role = (sample.role or "").strip()
            if role:
                warning = f"Set filament on these parts in Kit → Compose (role: {role})."
            else:
                warning = "Set filament on these parts in Kit → Compose."
        elif printers and len(printer_ids) > 1:
            warning = "Parts split across multiple printers."
        elif printers and key != "__unset__":
            loaded_ids = {fid for p in printers for fid in p.loaded_filament_ids()}
            if key not in loaded_ids:
                warning = "No enabled printer has this filament loaded in a spool slot."

        source_buckets: dict[tuple[str, str], dict[str, int]] = defaultdict(lambda: defaultdict(int))
        used_names: dict[tuple[str, str], set[str]] = defaultdict(set)
        display_by_match: dict[tuple[str, str, str], str] = {}

        for copy in fcopies:
            part = copy.part
            repo = repo_name_from_source_layer(part.source_layer)
            folder = folder_key_from_relative_path(part.relative_path)
            bucket_key = (repo, folder)
            used = used_names[bucket_key]
            display = object_display_name(part.filename, copy.unit, used)
            display_by_match[(repo, folder, part.match_key)] = display
            source_buckets[bucket_key][part.match_key] += 1

        sources: list[PrintPlanSourceGroup] = []
        for repo, folder in sorted(source_buckets.keys(), key=lambda k: (k[0].lower(), k[1].lower())):
            counts = source_buckets[(repo, folder)]
            lines: list[PrintPlanPartLine] = []
            for match_key, count in sorted(
                counts.items(),
                key=lambda item: display_by_match.get((repo, folder, item[0]), item[0]).lower(),
            ):
                lines.append(
                    PrintPlanPartLine(
                        label=display_by_match.get((repo, folder, match_key), match_key),
                        count=count,
                    )
                )
            sources.append(PrintPlanSourceGroup(repo=repo, folder=folder, lines=lines))

        groups.append(
            PrintPlanFilamentGroup(
                filament_key=key,
                filament_label=label,
                filament_hex=hex_color,
                part_count=len(fcopies),
                printer_name=printer_name,
                sources=sources,
                warning=warning,
            )
        )

    return groups, list(assign_warnings)


def _filament_sort_key(key: str) -> tuple[int, str]:
    if key == "__unset__":
        return (1, key)
    return (0, key.lower())
