"""Persisted per-kit plate assignments and manual rearrangement."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from print_partner.core.filament_assigner import PartCopy, assign_parts_to_printers
from print_partner.core.plate_packer import PlateLayout, pack_copies_on_printer
from print_partner.core.printer_fleet import PrinterMachine


@dataclass(frozen=True)
class CopyRef:
    match_key: str
    unit: int

    def to_dict(self) -> dict[str, Any]:
        return {"match_key": self.match_key, "unit": int(self.unit)}

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> CopyRef:
        return cls(match_key=str(data["match_key"]), unit=int(data.get("unit") or 1))

    @classmethod
    def from_copy(cls, copy: PartCopy) -> CopyRef:
        return cls(match_key=copy.part.match_key, unit=copy.unit)


def copy_ref_key(ref: CopyRef) -> tuple[str, int]:
    return ref.match_key, ref.unit


@dataclass
class PrinterPlatePlan:
    printer_id: str
    plates: list[list[CopyRef]] = field(default_factory=list)
    unassigned: list[CopyRef] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "printer_id": self.printer_id,
            "plates": [[r.to_dict() for r in plate] for plate in self.plates],
            "unassigned": [r.to_dict() for r in self.unassigned],
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> PrinterPlatePlan:
        plates_raw = data.get("plates") or []
        plates = [
            [CopyRef.from_dict(r) for r in plate if isinstance(r, dict)]
            for plate in plates_raw
            if isinstance(plate, list)
        ]
        unassigned = [
            CopyRef.from_dict(r)
            for r in (data.get("unassigned") or [])
            if isinstance(r, dict)
        ]
        return cls(
            printer_id=str(data.get("printer_id") or ""),
            plates=plates,
            unassigned=unassigned,
        )


@dataclass
class KitPlateLayout:
    spacing_mm: float = 4.0
    printers: list[PrinterPlatePlan] = field(default_factory=list)
    pool: list[CopyRef] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "spacing_mm": self.spacing_mm,
            "printers": [p.to_dict() for p in self.printers],
            "pool": [r.to_dict() for r in self.pool],
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> KitPlateLayout:
        return cls(
            spacing_mm=float(data.get("spacing_mm") or 4.0),
            printers=[
                PrinterPlatePlan.from_dict(p)
                for p in (data.get("printers") or [])
                if isinstance(p, dict)
            ],
            pool=[
                CopyRef.from_dict(r)
                for r in (data.get("pool") or [])
                if isinstance(r, dict)
            ],
        )

    def printer_plan(self, printer_id: str) -> PrinterPlatePlan | None:
        for plan in self.printers:
            if plan.printer_id == printer_id:
                return plan
        return None

    def ensure_printer(self, printer_id: str) -> PrinterPlatePlan:
        existing = self.printer_plan(printer_id)
        if existing is not None:
            return existing
        plan = PrinterPlatePlan(printer_id=printer_id)
        self.printers.append(plan)
        return plan


def auto_plate_layout(
    printers: list[PrinterMachine],
    copies: list[PartCopy],
    *,
    spacing_mm: float = 4.0,
) -> tuple[KitPlateLayout, list[str]]:
    """Assign copies to printers and bin-pack plates; return editable layout."""
    warnings: list[str] = []
    by_printer, assign_warnings = assign_parts_to_printers(copies, printers)
    warnings.extend(assign_warnings)

    layout = KitPlateLayout(spacing_mm=spacing_mm)
    for printer in printers:
        pcopies = by_printer.get(printer.id, [])
        if not pcopies:
            continue
        plates, pack_warnings = pack_copies_on_printer(
            printer, pcopies, spacing_mm=spacing_mm
        )
        warnings.extend(pack_warnings)
        plan = layout.ensure_printer(printer.id)
        plan.plates = [
            [CopyRef.from_copy(item.copy) for item in plate.items] for plate in plates
        ]
        plan.unassigned = []
    layout.pool = []
    return layout, warnings


def layout_with_pool(
    copies: list[PartCopy],
    *,
    spacing_mm: float = 4.0,
) -> KitPlateLayout:
    """Start with every copy in the unclassified pool (manual printer assignment)."""
    layout = KitPlateLayout(spacing_mm=spacing_mm)
    layout.pool = [CopyRef.from_copy(c) for c in copies]
    return layout


def printer_assigned_refs(plan: PrinterPlatePlan) -> list[CopyRef]:
    refs: list[CopyRef] = []
    for plate in plan.plates:
        refs.extend(plate)
    refs.extend(plan.unassigned)
    return refs


def assign_refs_to_printer(
    layout: KitPlateLayout,
    refs: list[CopyRef],
    printer_id: str,
) -> int:
    """Move copies from the pool (or elsewhere) onto a printer. Returns count moved."""
    plan = layout.ensure_printer(printer_id)
    moved = 0
    for ref in refs:
        if not remove_copy(layout, ref):
            continue
        plan.unassigned.append(ref)
        moved += 1
    return moved


def return_refs_to_pool(layout: KitPlateLayout, refs: list[CopyRef]) -> int:
    """Unassign copies and place them in the global unclassified pool."""
    moved = 0
    for ref in refs:
        if not remove_copy(layout, ref):
            continue
        key = copy_ref_key(ref)
        if key not in {copy_ref_key(r) for r in layout.pool}:
            layout.pool.append(ref)
            moved += 1
    return moved


def _copy_lookup(copies: list[PartCopy]) -> dict[tuple[str, int], PartCopy]:
    return {copy_ref_key(CopyRef.from_copy(c)): c for c in copies}


def _resolve_refs(refs: list[CopyRef], lookup: dict[tuple[str, int], PartCopy]) -> list[PartCopy]:
    result: list[PartCopy] = []
    for ref in refs:
        copy = lookup.get(copy_ref_key(ref))
        if copy is not None:
            result.append(copy)
    return result


def prune_layout(layout: KitPlateLayout, copies: list[PartCopy]) -> None:
    """Drop refs that no longer exist in the current kit."""
    lookup = _copy_lookup(copies)
    valid = set(lookup.keys())
    layout.pool = [r for r in layout.pool if copy_ref_key(r) in valid]
    assigned: set[tuple[str, int]] = {copy_ref_key(r) for r in layout.pool}
    for plan in layout.printers:
        plan.plates = [
            [r for r in plate if copy_ref_key(r) in valid] for plate in plan.plates
        ]
        plan.unassigned = [r for r in plan.unassigned if copy_ref_key(r) in valid]
        for plate in plan.plates:
            assigned.update(copy_ref_key(r) for r in plate)
        assigned.update(copy_ref_key(r) for r in plan.unassigned)
    for key, copy in lookup.items():
        if key not in assigned:
            layout.pool.append(CopyRef.from_copy(copy))


def resolve_layout_to_plates(
    layout: KitPlateLayout,
    printers: list[PrinterMachine],
    copies: list[PartCopy],
) -> tuple[list[tuple[PrinterMachine, PlateLayout]], list[str]]:
    """Turn saved layout into positioned PlateLayout list for export."""
    warnings: list[str] = []
    by_printer, assign_warnings = assign_parts_to_printers(copies, printers)
    warnings.extend(assign_warnings)
    lookup = _copy_lookup(copies)
    all_plates: list[tuple[PrinterMachine, PlateLayout]] = []

    if layout.pool:
        warnings.append(
            f"{len(layout.pool)} part(s) still unclassified — assign to a printer before export."
        )

    for printer in printers:
        plan = layout.printer_plan(printer.id)
        if plan is None:
            pcopies = by_printer.get(printer.id, [])
            if not pcopies:
                continue
            plates, pack_warnings = pack_copies_on_printer(
                printer, pcopies, spacing_mm=layout.spacing_mm
            )
            warnings.extend(pack_warnings)
            for plate in plates:
                all_plates.append((printer, plate))
            continue

        assigned_refs = printer_assigned_refs(plan)
        if not assigned_refs:
            continue
        pcopies = _resolve_refs(assigned_refs, lookup)
        if not pcopies:
            continue
        plates, pack_warnings = pack_copies_on_printer(
            printer, pcopies, spacing_mm=layout.spacing_mm
        )
        warnings.extend(pack_warnings)
        for plate in plates:
            all_plates.append((printer, plate))

    return all_plates, warnings


def renumber_plates(plan: PrinterPlatePlan) -> None:
    """Drop empty plates except keep at least zero plates allowed."""
    plan.plates = [plate for plate in plan.plates if plate]


def move_copy(
    layout: KitPlateLayout,
    ref: CopyRef,
    *,
    printer_id: str,
    plate_index: int | None,
    position: int | None = None,
) -> bool:
    """Move a copy to a plate (1-based index) or unassigned (plate_index None)."""
    removed = remove_copy(layout, ref)
    if not removed:
        return False
    plan = layout.ensure_printer(printer_id)
    if plate_index is None:
        plan.unassigned.append(ref)
        return True
    idx = max(1, plate_index) - 1
    while len(plan.plates) < idx + 1:
        plan.plates.append([])
    plate_list = plan.plates[idx]
    if position is None or position < 0 or position > len(plate_list):
        plate_list.append(ref)
    else:
        plate_list.insert(position, ref)
    return True


def remove_copy(layout: KitPlateLayout, ref: CopyRef) -> bool:
    key = copy_ref_key(ref)
    found = False
    kept_pool = [r for r in layout.pool if copy_ref_key(r) != key]
    if len(kept_pool) != len(layout.pool):
        found = True
    layout.pool = kept_pool
    for plan in layout.printers:
        new_plates: list[list[CopyRef]] = []
        for plate in plan.plates:
            kept = [r for r in plate if copy_ref_key(r) != key]
            if len(kept) != len(plate):
                found = True
            new_plates.append(kept)
        plan.plates = new_plates
        kept_un = [r for r in plan.unassigned if copy_ref_key(r) != key]
        if len(kept_un) != len(plan.unassigned):
            found = True
        plan.unassigned = kept_un
    renumber_plates_for_layout(layout)
    return found


def renumber_plates_for_layout(layout: KitPlateLayout) -> None:
    for plan in layout.printers:
        renumber_plates(plan)


def add_empty_plate(layout: KitPlateLayout, printer_id: str) -> int:
    """Append an empty plate; returns 1-based index."""
    plan = layout.ensure_printer(printer_id)
    plan.plates.append([])
    return len(plan.plates)


def remove_plate(layout: KitPlateLayout, printer_id: str, plate_index: int) -> bool:
    plan = layout.printer_plan(printer_id)
    if plan is None:
        return False
    idx = plate_index - 1
    if idx < 0 or idx >= len(plan.plates):
        return False
    moved = plan.plates.pop(idx)
    plan.unassigned.extend(moved)
    renumber_plates(plan)
    return True


def move_within_plate(
    layout: KitPlateLayout,
    ref: CopyRef,
    printer_id: str,
    plate_index: int,
    delta: int,
) -> bool:
    plan = layout.printer_plan(printer_id)
    if plan is None:
        return False
    idx = plate_index - 1
    if idx < 0 or idx >= len(plan.plates):
        return False
    plate = plan.plates[idx]
    key = copy_ref_key(ref)
    try:
        pos = next(i for i, r in enumerate(plate) if copy_ref_key(r) == key)
    except StopIteration:
        return False
    new_pos = pos + delta
    if new_pos < 0 or new_pos >= len(plate):
        return False
    plate.pop(pos)
    plate.insert(new_pos, ref)
    return True
