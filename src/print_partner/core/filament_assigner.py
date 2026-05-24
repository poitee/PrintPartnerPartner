"""Assign kit part copies to printers by loaded filament."""

from __future__ import annotations

from dataclasses import dataclass

from print_partner.core.merge import MergePart
from print_partner.core.printer_fleet import PrinterMachine


@dataclass
class PartCopy:
    part: MergePart
    unit: int


def _part_filament_key(part: MergePart) -> str | None:
    if part.filament_color_id:
        return part.filament_color_id
    display = (part.filament_display or "").strip()
    if display:
        return f"display:{display}"
    return None


def assign_parts_to_printers(
    copies: list[PartCopy],
    printers: list[PrinterMachine],
) -> tuple[dict[str, list[PartCopy]], list[str]]:
    """Map printer_id -> copies to print on that machine."""
    warnings: list[str] = []
    by_printer: dict[str, list[PartCopy]] = {p.id: [] for p in printers}
    if not printers:
        return by_printer, ["No printers enabled for this kit."]

    filament_to_printers: dict[str, list[str]] = {}
    for printer in printers:
        for fid in printer.loaded_filament_ids():
            filament_to_printers.setdefault(fid, []).append(printer.id)

    def pick_printer(candidates: list[str]) -> str:
        return min(candidates, key=lambda pid: len(by_printer[pid]))

    default_printer = printers[0].id

    for copy in copies:
        key = _part_filament_key(copy.part)
        if key and key in filament_to_printers:
            by_printer[pick_printer(filament_to_printers[key])].append(copy)
            continue

        if key:
            label = copy.part.filament_display or copy.part.filament_color_id or key
            warnings.append(
                f"No printer has {label} loaded — assigned to {printers[0].name} "
                f"({copy.part.filename})"
            )
        elif copy.part.role:
            warnings.append(
                f"No filament on {copy.part.filename} (role {copy.part.role}) — "
                f"assigned to {printers[0].name}"
            )
        by_printer[default_printer].append(copy)

    return by_printer, warnings


def assignment_preview(
    by_printer: dict[str, list[PartCopy]],
    printers: list[PrinterMachine],
) -> list[tuple[str, str, list[str]]]:
    """Rows of (printer_name, filament_summary, part filenames)."""
    from print_partner.core.export_3mf import object_display_name

    name_by_id = {p.id: p.name for p in printers}
    rows: list[tuple[str, str, list[str]]] = []
    for pid, copies in by_printer.items():
        if not copies:
            continue
        filaments: set[str] = set()
        names: list[str] = []
        used: set[str] = set()
        for c in copies:
            label = (c.part.filament_display or c.part.filament_color_id or c.part.role or "").strip()
            if label:
                filaments.add(label)
            names.append(object_display_name(c.part.filename, c.unit, used))
        rows.append(
            (
                name_by_id.get(pid, pid),
                ", ".join(sorted(filaments)) or "(no filament)",
                names,
            )
        )
    return rows
