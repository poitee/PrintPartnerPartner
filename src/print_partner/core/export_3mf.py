"""Export kit as 3MF with multi-printer plate layout and filament colors."""

from __future__ import annotations

import json
import re
import zipfile
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path
from typing import Literal

import lib3mf
import trimesh

from print_partner.core.filament_assigner import PartCopy, assign_parts_to_printers
from print_partner.core.merge import MergePart
from print_partner.core.mesh_color import resolve_mesh_color
from print_partner.core.plate_packer import PlateLayout, PlacedItem, pack_copies_on_printer
from print_partner.core.printer_fleet import PrinterMachine

ProgressCallback = Callable[[int, int, str], None]

ExportLayoutMode = Literal["per_plate", "zip", "single_offset", "single_plate_only"]

_INVALID_XML_CHARS = re.compile(r"[^\w\s.\-()+]")
_PLATE_GAP_MM = 20.0


@dataclass
class Export3mfOptions:
    layout_mode: ExportLayoutMode = "per_plate"
    spacing_mm: float = 4.0
    enabled_printers: list[PrinterMachine] = field(default_factory=list)
    # When set, export uses these plate positions instead of auto-packing.
    plate_layouts: list[tuple[PrinterMachine, PlateLayout]] | None = None


@dataclass
class Export3mfResult:
    primary_path: Path
    paths: list[Path]
    object_count: int
    plate_count: int
    warnings: list[str]
    printer_summaries: list[str]


def sanitize_3mf_object_name(name: str) -> str:
    base = Path(name).name.strip() or "part.stl"
    cleaned = _INVALID_XML_CHARS.sub("_", base)
    return cleaned[:200] if cleaned else "part.stl"


def object_display_name(filename: str, unit: int, used_names: set[str]) -> str:
    base = sanitize_3mf_object_name(filename)
    if unit <= 1:
        display = base
    else:
        stem = Path(base).stem
        suffix = Path(base).suffix or ".stl"
        display = sanitize_3mf_object_name(f"{stem}{suffix} ({unit})")

    if display not in used_names:
        used_names.add(display)
        return display

    stem = Path(base).stem
    suffix = Path(base).suffix or ".stl"
    n = 2
    while True:
        candidate = sanitize_3mf_object_name(f"{stem}{suffix} ({n})")
        if candidate not in used_names:
            used_names.add(candidate)
            return candidate
        n += 1


def _filament_material_key(part: MergePart) -> tuple[str, str]:
    label = (part.filament_display or "").strip() or part.role
    fid = part.filament_color_id or label
    return fid, label


def _hex_to_lib3mf_color(wrapper: lib3mf.Wrapper, hex_color: str) -> object:
    h = hex_color if hex_color.startswith("#") else f"#{hex_color.lstrip('#')}"
    return wrapper.RGBAToColor(int(h[1:3], 16), int(h[3:5], 16), int(h[5:7], 16), 255)


def _lib3mf_position(x: float, y: float, z: float) -> lib3mf.Position:
    p = lib3mf.Position()
    p.Coordinates[0] = float(x)
    p.Coordinates[1] = float(y)
    p.Coordinates[2] = float(z)
    return p


def _lib3mf_triangle(a: int, b: int, c: int) -> lib3mf.Triangle:
    t = lib3mf.Triangle()
    t.Indices[0] = int(a)
    t.Indices[1] = int(b)
    t.Indices[2] = int(c)
    return t


def _add_trimesh_to_object(mesh_object: object, mesh: trimesh.Trimesh) -> None:
    for v in mesh.vertices:
        mesh_object.AddVertex(_lib3mf_position(v[0], v[1], v[2]))
    for f in mesh.faces:
        mesh_object.AddTriangle(_lib3mf_triangle(f[0], f[1], f[2]))


def _write_items_to_model(
    model: object,
    wrapper: lib3mf.Wrapper,
    items: list[PlacedItem],
    used_names: set[str],
    material_by_key: dict[str, tuple[object, int]],
    x_offset: float = 0.0,
) -> int:
    count = 0
    for placed in items:
        copy = placed.copy
        part = copy.part
        mesh = placed.mesh
        if x_offset:
            mesh = mesh.copy()
            mesh.apply_translation([x_offset, 0.0, 0.0])

        display_name = object_display_name(part.filename, copy.unit, used_names)
        mesh_object = model.AddMeshObject()
        mesh_object.SetName(display_name)
        mesh_object.SetPartNumber(display_name)
        _add_trimesh_to_object(mesh_object, mesh)

        key, label = _filament_material_key(part)
        if key not in material_by_key:
            group = model.AddBaseMaterialGroup()
            display_hex = resolve_mesh_color(part.role, part.filament_hex)
            prop_id = group.AddMaterial(label, _hex_to_lib3mf_color(wrapper, display_hex))
            material_by_key[key] = (group, prop_id)
        group, prop_id = material_by_key[key]
        mesh_object.SetObjectLevelProperty(group.GetResourceID(), prop_id)

        build_item = model.AddBuildItem(mesh_object, wrapper.GetIdentityTransform())
        build_item.SetPartNumber(display_name)
        count += 1
    return count


def _write_plate_file(
    path: Path,
    items: list[PlacedItem],
    x_offset: float = 0.0,
) -> int:
    wrapper = lib3mf.get_wrapper()
    model = wrapper.CreateModel()
    material_by_key: dict[str, tuple[object, int]] = {}
    used_names: set[str] = set()
    count = _write_items_to_model(model, wrapper, items, used_names, material_by_key, x_offset)
    if count > 0:
        model.QueryWriter("3mf").WriteToFile(str(path))
    return count


def _slug(name: str) -> str:
    return re.sub(r"[^\w\-.]+", "_", name.replace(" ", "_"))


def export_profile_3mf(
    profile_name: str,
    parts: list[MergePart],
    exports_dir: Path,
    on_progress: ProgressCallback | None = None,
    *,
    cancel_check: Callable[[], bool] | None = None,
    options: Export3mfOptions | None = None,
) -> Export3mfResult:
    """Export using print plan printers, plate packing, and layout mode."""
    opts = options or Export3mfOptions()
    safe_profile = _slug(profile_name)
    output_dir = exports_dir / safe_profile / "3mf_export"
    output_dir.mkdir(parents=True, exist_ok=True)

    included = [p for p in parts if p.included]
    missing_path = [p for p in included if not p.absolute_path or not p.absolute_path.is_file()]
    exportable = [p for p in included if p.absolute_path and p.absolute_path.is_file()]

    warnings: list[str] = [
        f"Missing STL: {p.relative_path} ({p.source_layer})" for p in missing_path
    ]

    copies: list[PartCopy] = []
    for part in exportable:
        qty = max(1, part.quantity_effective)
        for unit in range(1, qty + 1):
            copies.append(PartCopy(part=part, unit=unit))

    empty = Export3mfResult(
        primary_path=output_dir / f"{safe_profile}.3mf",
        paths=[],
        object_count=0,
        plate_count=0,
        warnings=warnings,
        printer_summaries=[],
    )
    if not copies:
        return empty

    printers = opts.enabled_printers
    if not printers:
        warnings.append("No printers enabled. Configure printers on the Print tab.")
        return empty

    if opts.plate_layouts:
        all_plates = list(opts.plate_layouts)
        total_work = sum(len(plate.items) for _, plate in all_plates)
        done = 0
        for _printer, plate in all_plates:
            for item in plate.items:
                done += 1
                if cancel_check and cancel_check():
                    break
                if on_progress:
                    on_progress(
                        done,
                        max(1, total_work),
                        item.copy.part.filename if plate.items else "",
                    )
    else:
        by_printer, assign_warnings = assign_parts_to_printers(copies, printers)
        warnings.extend(assign_warnings)

        all_plates = []
        total_work = sum(len(by_printer[p.id]) for p in printers)
        done = 0

        for printer in printers:
            pcopies = by_printer.get(printer.id, [])
            if not pcopies:
                continue
            plates, pack_warnings = pack_copies_on_printer(
                printer, pcopies, spacing_mm=opts.spacing_mm
            )
            warnings.extend(pack_warnings)
            for plate in plates:
                all_plates.append((printer, plate))
                for _ in plate.items:
                    done += 1
                    if cancel_check and cancel_check():
                        break
                    if on_progress:
                        on_progress(
                            done,
                            max(1, total_work),
                            plate.items[0].copy.part.filename if plate.items else "",
                        )

    if not all_plates:
        return empty

    if opts.layout_mode == "single_plate_only":
        multi = sum(1 for _, p in printers if len([pl for pr, pl in all_plates if pr.id == p.id]) > 1)
        if multi > 0 or len(all_plates) > 1:
            warnings.append(
                "Single-plate export requires everything to fit on one bed. "
                "Use per-plate or zip mode, or enable a larger printer."
            )
            return empty

    paths: list[Path] = []
    object_count = 0
    manifest_printers: list[dict] = []
    summaries: list[str] = []

    if opts.layout_mode == "single_offset":
        wrapper = lib3mf.get_wrapper()
        model = wrapper.CreateModel()
        material_by_key: dict[str, tuple[object, int]] = {}
        used_names: set[str] = set()
        x_cursor = 0.0
        for printer, plate in all_plates:
            object_count += _write_items_to_model(
                model, wrapper, plate.items, used_names, material_by_key, x_cursor
            )
            x_cursor += printer.bed_width_mm + _PLATE_GAP_MM
        out_path = output_dir / f"{safe_profile}.3mf"
        if object_count > 0:
            model.QueryWriter("3mf").WriteToFile(str(out_path))
            paths.append(out_path)
    else:
        for printer, plate in all_plates:
            slug_printer = _slug(printer.name)
            fname = f"{safe_profile}_{slug_printer}_plate_{plate.index:02d}.3mf"
            out_path = output_dir / fname
            n = _write_plate_file(out_path, plate.items)
            object_count += n
            if n > 0:
                paths.append(out_path)

    for printer in printers:
        printer_plates = [pl for pr, pl in all_plates if pr.id == printer.id]
        if not printer_plates:
            continue
        summaries.append(f"{printer.name}: {len(printer_plates)} plate(s)")
        plate_entries = []
        from print_partner.core.plate_preview import group_plate_items_by_source

        for plate in printer_plates:
            groups = group_plate_items_by_source(plate.items)
            part_names: list[str] = []
            for group in groups:
                part_names.extend(group.part_names)
            fname = f"{safe_profile}_{_slug(printer.name)}_plate_{plate.index:02d}.3mf"
            plate_entries.append(
                {
                    "file": fname,
                    "parts": part_names,
                    "groups": [
                        {
                            "repo": g.repo,
                            "folder": g.folder,
                            "parts": g.part_names,
                        }
                        for g in groups
                    ],
                }
            )
        manifest_printers.append(
            {
                "id": printer.id,
                "name": printer.name,
                "bed_mm": [printer.bed_width_mm, printer.bed_depth_mm],
                "plates": plate_entries,
            }
        )

    manifest = {
        "kit": profile_name,
        "layout_mode": opts.layout_mode,
        "printers": manifest_printers,
        "warnings": warnings,
    }
    manifest_path = output_dir / "print_plan.json"
    manifest_path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")

    if opts.layout_mode == "zip" and paths:
        zip_path = output_dir / f"{safe_profile}_plates.zip"
        with zipfile.ZipFile(zip_path, "w", compression=zipfile.ZIP_DEFLATED) as zf:
            for p in paths:
                zf.write(p, arcname=p.name)
            zf.write(manifest_path, arcname="print_plan.json")

    primary = paths[0] if paths else output_dir / f"{safe_profile}.3mf"
    if opts.layout_mode == "zip":
        zip_path = output_dir / f"{safe_profile}_plates.zip"
        if zip_path.is_file():
            primary = zip_path

    return Export3mfResult(
        primary_path=primary,
        paths=paths,
        object_count=object_count,
        plate_count=len(all_plates),
        warnings=warnings,
        printer_summaries=summaries,
    )


# Backward-compatible tuple API for simple callers
def export_profile_3mf_legacy(
    profile_name: str,
    parts: list[MergePart],
    exports_dir: Path,
    on_progress: ProgressCallback | None = None,
    *,
    cancel_check: Callable[[], bool] | None = None,
) -> tuple[Path, int, list[str]]:
    from print_partner.core.printer_fleet import load_fleet

    fleet = load_fleet()
    if not fleet:
        from print_partner.core.printer_fleet import load_printer_presets, new_machine_from_preset

        preset = load_printer_presets()[-1]
        fleet = [new_machine_from_preset(preset, "Default")]
    opts = Export3mfOptions(enabled_printers=fleet[:1])
    result = export_profile_3mf(
        profile_name, parts, exports_dir, on_progress, cancel_check=cancel_check, options=opts
    )
    return result.primary_path, result.object_count, result.warnings
