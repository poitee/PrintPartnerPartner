"""Export and import portable kit bundles for sharing between Print Partner users."""

from __future__ import annotations

import json
import re
import zipfile
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from print_partner.core.custom_filaments import (
    collect_custom_ids_from_parts,
    library_to_export_dict,
    merge_filaments_from_dict,
)
from print_partner.core.print_progress import ensure_profile_progress
from print_partner.db.models import BuildProfile, Part, ProfileLayer, Project
from print_partner.db.session import get_profile_layers, get_profile_parts, list_projects

KIT_FORMAT = "print-partner-kit"
KIT_VERSION = 1
KIT_JSON_NAME = "kit.json"
KIT_EXTENSION = ".print-partner-kit.zip"


@dataclass(frozen=True)
class KitImportResult:
    profile_id: int
    profile_name: str
    parts_imported: int
    layers_imported: int
    unmatched_projects: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)


def _safe_bundle_stem(name: str) -> str:
    stem = re.sub(r"[^\w\-.]+", "_", (name or "kit").strip())[:80]
    return stem or "kit"


def export_path_for_kit(name: str, exports_dir: Path) -> Path:
    exports_dir.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    return exports_dir / f"{_safe_bundle_stem(name)}-{stamp}{KIT_EXTENSION}"


def profile_to_bundle_dict(
    session: Session,
    profile_id: int,
    *,
    include_print_progress: bool = False,
) -> dict[str, Any]:
    profile = session.get(BuildProfile, profile_id)
    if not profile:
        raise ValueError("Profile not found")

    layers_out: list[dict[str, Any]] = []
    for layer in get_profile_layers(session, profile_id):
        entry: dict[str, Any] = {
            "layer_order": layer.layer_order,
            "layer_type": layer.layer_type,
            "project": None,
        }
        if layer.project_id:
            proj = session.get(Project, layer.project_id)
            if proj:
                entry["project"] = {
                    "name": proj.name,
                    "url": proj.url,
                    "branch": proj.branch or "main",
                    "source_type": proj.source_type or "git",
                }
        layers_out.append(entry)

    parts_out: list[dict[str, Any]] = []
    progress_by_match: dict[str, list[bool]] = {}
    if include_print_progress:
        from print_partner.core.print_progress import get_print_units

        for part in get_profile_parts(session, profile_id):
            qty = max(1, part.quantity_effective)
            progress_by_match[part.match_key] = get_print_units(session, part.id, qty)

    parts_list = get_profile_parts(session, profile_id)
    custom_refs = collect_custom_ids_from_parts(parts_list)

    for part in parts_list:
        row: dict[str, Any] = {
            "match_key": part.match_key,
            "relative_path": part.relative_path,
            "filename": part.filename,
            "source_layer": part.source_layer,
            "status": part.status,
            "role": part.role,
            "filament_color_id": part.filament_color_id,
            "filament_custom_hex": part.filament_custom_hex,
            "quantity_auto": part.quantity_auto,
            "quantity_override": part.quantity_override,
            "quantity_effective": part.quantity_effective,
            "included": part.included,
            "notes": part.notes or "",
            "github_blob_url": part.github_blob_url,
            "geometry_same": part.geometry_same,
        }
        if include_print_progress and part.match_key in progress_by_match:
            row["print_units"] = progress_by_match[part.match_key]
        parts_out.append(row)

    bundle: dict[str, Any] = {
        "format": KIT_FORMAT,
        "version": KIT_VERSION,
        "exported_at": datetime.now(timezone.utc).isoformat(),
        "profile": {
            "name": profile.name,
            "order_number": profile.order_number,
        },
        "layers": layers_out,
        "parts": parts_out,
    }
    if custom_refs:
        bundle["custom_filaments"] = library_to_export_dict(custom_refs)["filaments"]
    return bundle


def export_kit_bundle(
    session: Session,
    profile_id: int,
    dest: Path,
    *,
    include_print_progress: bool = False,
) -> Path:
    """Write a shareable kit zip; returns the path written."""
    data = profile_to_bundle_dict(
        session, profile_id, include_print_progress=include_print_progress
    )
    dest.parent.mkdir(parents=True, exist_ok=True)
    payload = json.dumps(data, indent=2, ensure_ascii=False).encode("utf-8")
    with zipfile.ZipFile(dest, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        zf.writestr(KIT_JSON_NAME, payload)
    return dest


def _load_bundle_dict(path: Path) -> dict[str, Any]:
    path = Path(path)
    if path.suffix == ".zip" or path.name.endswith(KIT_EXTENSION):
        with zipfile.ZipFile(path, "r") as zf:
            if KIT_JSON_NAME not in zf.namelist():
                raise ValueError(f"Missing {KIT_JSON_NAME} in kit archive")
            raw = zf.read(KIT_JSON_NAME).decode("utf-8")
    elif path.suffix == ".json":
        raw = path.read_text(encoding="utf-8")
    else:
        raise ValueError("Expected a .print-partner-kit.zip or kit.json file")
    data = json.loads(raw)
    if data.get("format") != KIT_FORMAT:
        raise ValueError("Not a Print Partner kit file")
    if int(data.get("version", 0)) != KIT_VERSION:
        raise ValueError(f"Unsupported kit version (expected {KIT_VERSION})")
    return data


def _resolve_project_id(session: Session, ref: dict[str, Any] | None) -> int | None:
    if not ref:
        return None
    name = (ref.get("name") or "").strip()
    url = (ref.get("url") or "").strip()
    branch = (ref.get("branch") or "main").strip()
    projects = list_projects(session)
    for proj in projects:
        if name and proj.name == name:
            return proj.id
    for proj in projects:
        if url and proj.url == url:
            return proj.id
    for proj in projects:
        if name and proj.name.lower() == name.lower():
            return proj.id
    if name:
        for proj in projects:
            if url and proj.url.rstrip("/") == url.rstrip("/") and (proj.branch or "main") == branch:
                return proj.id
    return None


def _unique_profile_name(session: Session, desired: str) -> str:
    base = (desired or "Imported kit").strip() or "Imported kit"
    if not session.scalars(select(BuildProfile).where(BuildProfile.name == base)).first():
        return base
    for n in range(2, 100):
        candidate = f"{base} ({n})"
        if not session.scalars(select(BuildProfile).where(BuildProfile.name == candidate)).first():
            return candidate
    raise ValueError("Could not find a unique kit name")


def import_kit_bundle(
    session: Session,
    path: Path,
    *,
    new_name: str | None = None,
    include_print_progress: bool | None = None,
) -> KitImportResult:
    """
    Import a kit bundle into the local database.

    Projects are matched by name, then URL. Unmatched layer projects are skipped
    with a warning. Print progress is imported only when present in the bundle
    unless include_print_progress=False.
    """
    data = _load_bundle_dict(path)
    if data.get("custom_filaments"):
        merge_filaments_from_dict({"filaments": data["custom_filaments"]})
    profile_data = data.get("profile") or {}
    desired_name = (new_name or profile_data.get("name") or "Imported kit").strip()
    name = _unique_profile_name(session, desired_name)

    profile = BuildProfile(
        name=name,
        order_number=profile_data.get("order_number"),
    )
    session.add(profile)
    session.flush()

    unmatched: list[str] = []
    warnings: list[str] = []
    layers_imported = 0
    for layer_data in data.get("layers") or []:
        ref = layer_data.get("project")
        project_id = _resolve_project_id(session, ref)
        if ref and project_id is None:
            label = ref.get("name") or ref.get("url") or "unknown"
            unmatched.append(str(label))
            warnings.append(
                f"Layer {layer_data.get('layer_type')}: no local repo “{label}”. "
                "Add/sync it on Libraries, then edit layers."
            )
            continue
        session.add(
            ProfileLayer(
                profile_id=profile.id,
                layer_order=int(layer_data.get("layer_order", layers_imported)),
                layer_type=str(layer_data.get("layer_type") or "addon"),
                project_id=project_id,
            )
        )
        layers_imported += 1

    parts_data = data.get("parts") or []
    for row in parts_data:
        session.add(
            Part(
                profile_id=profile.id,
                match_key=str(row["match_key"]),
                relative_path=str(row.get("relative_path") or ""),
                filename=str(row.get("filename") or ""),
                source_layer=str(row.get("source_layer") or ""),
                status=str(row.get("status") or "base"),
                role=str(row.get("role") or "primary"),
                filament_color_id=row.get("filament_color_id"),
                filament_custom_hex=row.get("filament_custom_hex"),
                quantity_auto=int(row.get("quantity_auto") or 1),
                quantity_override=row.get("quantity_override"),
                quantity_effective=int(row.get("quantity_effective") or 1),
                included=bool(row.get("included", True)),
                notes=str(row.get("notes") or ""),
                github_blob_url=row.get("github_blob_url"),
                geometry_same=row.get("geometry_same"),
            )
        )
    session.flush()

    has_progress_in_bundle = any("print_units" in row for row in parts_data)
    apply_progress = (
        include_print_progress
        if include_print_progress is not None
        else has_progress_in_bundle
    )
    if apply_progress and has_progress_in_bundle:
        from print_partner.core.print_progress import set_unit_completed

        parts_by_key = {p.match_key: p for p in get_profile_parts(session, profile.id)}
        for row in parts_data:
            units = row.get("print_units")
            if not units:
                continue
            part = parts_by_key.get(row["match_key"])
            if not part:
                continue
            for idx, done in enumerate(units):
                set_unit_completed(session, part.id, idx, bool(done))
    else:
        ensure_profile_progress(session, profile.id)

    if not parts_data:
        warnings.append("Kit has no parts — run Recompute after repos are linked.")

    return KitImportResult(
        profile_id=profile.id,
        profile_name=name,
        parts_imported=len(parts_data),
        layers_imported=layers_imported,
        unmatched_projects=unmatched,
        warnings=warnings,
    )
