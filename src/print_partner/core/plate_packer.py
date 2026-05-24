"""Bin-pack part meshes onto printer beds (multi-plate)."""

from __future__ import annotations

from dataclasses import dataclass
from copy import deepcopy

import trimesh

from print_partner.core.filament_assigner import PartCopy
from print_partner.core.printer_fleet import PrinterMachine


@dataclass
class PlacedItem:
    copy: PartCopy
    mesh: trimesh.Trimesh
    x_mm: float
    y_mm: float
    width_mm: float
    depth_mm: float
    height_mm: float


@dataclass
class PlateLayout:
    printer_id: str
    index: int
    items: list[PlacedItem]


def load_mesh_for_copy(copy: PartCopy) -> tuple[trimesh.Trimesh | None, str | None]:
    part = copy.part
    stl_path = part.absolute_path
    if not stl_path or not stl_path.is_file():
        return None, f"Missing STL: {part.relative_path}"
    try:
        loaded = trimesh.load(stl_path, force="mesh")
    except Exception as exc:
        return None, f"Could not load {part.relative_path}: {exc}"

    if isinstance(loaded, trimesh.Scene):
        meshes = [g for g in loaded.geometry.values() if isinstance(g, trimesh.Trimesh)]
        mesh = trimesh.util.concatenate(meshes) if meshes else None
    elif isinstance(loaded, trimesh.Trimesh):
        mesh = loaded
    else:
        mesh = None

    if mesh is None or mesh.vertices.shape[0] == 0:
        return None, f"Empty mesh: {part.relative_path}"
    return mesh, None


def _place_on_bed(mesh: trimesh.Trimesh, x: float, y: float) -> trimesh.Trimesh:
    m = deepcopy(mesh)
    bounds = m.bounds
    m.apply_translation([x - bounds[0][0], y - bounds[0][1], -bounds[0][2]])
    return m


def pack_copies_on_printer(
    printer: PrinterMachine,
    copies: list[PartCopy],
    *,
    spacing_mm: float | None = None,
) -> tuple[list[PlateLayout], list[str]]:
    """Shelf-pack copies onto one or more plates for a single printer."""
    warnings: list[str] = []
    if not copies:
        return [], warnings

    margin = printer.margin_mm
    spacing = spacing_mm if spacing_mm is not None else margin
    bed_w = printer.bed_width_mm - 2 * margin
    bed_d = printer.bed_depth_mm - 2 * margin
    max_z = printer.bed_height_mm

    loaded: list[tuple[PartCopy, trimesh.Trimesh, float, float, float]] = []
    for copy in copies:
        mesh, err = load_mesh_for_copy(copy)
        if err:
            warnings.append(err)
            continue
        assert mesh is not None
        w, d, h = (float(x) for x in mesh.extents)
        if w > bed_w or d > bed_d:
            warnings.append(
                f"{copy.part.filename} ({w:.0f}×{d:.0f} mm) too large for "
                f"{printer.name} bed ({printer.bed_width_mm:.0f}×{printer.bed_depth_mm:.0f} mm)"
            )
            continue
        if max_z is not None and h > max_z:
            warnings.append(
                f"{copy.part.filename} height {h:.0f} mm exceeds "
                f"{printer.name} Z limit {max_z:.0f} mm"
            )
        loaded.append((copy, mesh, w, d, h))

    loaded.sort(key=lambda t: max(t[2], t[3]), reverse=True)

    plates: list[PlateLayout] = []
    current_items: list[PlacedItem] = []
    layout_x = 0.0
    layout_y = 0.0
    row_height = 0.0
    plate_index = 1

    def flush_plate() -> None:
        nonlocal current_items, layout_x, layout_y, row_height, plate_index
        if current_items:
            plates.append(
                PlateLayout(printer_id=printer.id, index=plate_index, items=current_items)
            )
            plate_index += 1
        current_items = []
        layout_x = 0.0
        layout_y = 0.0
        row_height = 0.0

    for copy, mesh, width, depth, height in loaded:
        if layout_x > 0 and layout_x + width > bed_w:
            layout_x = 0.0
            layout_y += row_height + spacing
            row_height = 0.0

        if layout_y + depth > bed_d:
            flush_plate()

        placed_mesh = _place_on_bed(mesh, margin + layout_x, margin + layout_y)
        current_items.append(
            PlacedItem(
                copy=copy,
                mesh=placed_mesh,
                x_mm=margin + layout_x,
                y_mm=margin + layout_y,
                width_mm=width,
                depth_mm=depth,
                height_mm=height,
            )
        )
        layout_x += width + spacing
        row_height = max(row_height, depth)

    flush_plate()
    return plates, warnings


def pack_single_plate(
    printer: PrinterMachine,
    copies: list[PartCopy],
    *,
    plate_index: int = 1,
    spacing_mm: float | None = None,
) -> tuple[PlateLayout | None, list[str]]:
    """Pack copies onto one logical plate (warn if auto-pack would need more beds)."""
    if not copies:
        return None, []
    plates, warnings = pack_copies_on_printer(printer, copies, spacing_mm=spacing_mm)
    if not plates:
        return None, warnings
    if len(plates) > 1:
        warnings = list(warnings) + [
            f"Plate {plate_index} on {printer.name}: parts may not fit one bed "
            f"(auto-pack used {len(plates)} plates)."
        ]
    items: list[PlacedItem] = []
    for plate in plates:
        items.extend(plate.items)
    return PlateLayout(printer_id=printer.id, index=plate_index, items=items), warnings


def estimate_plate_counts(
    printers: list[PrinterMachine],
    by_printer: dict[str, list[PartCopy]],
) -> dict[str, int]:
    counts: dict[str, int] = {}
    for printer in printers:
        copies = by_printer.get(printer.id, [])
        if not copies:
            counts[printer.id] = 0
            continue
        plates, _ = pack_copies_on_printer(printer, copies)
        counts[printer.id] = len(plates)
    return counts
