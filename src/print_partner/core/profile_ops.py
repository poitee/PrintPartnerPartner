"""Profile and layer management operations."""

from __future__ import annotations

from pathlib import Path

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from print_partner.core.merge import MergePart, merge_layers
from print_partner.core.import_rules import import_rules_for_project
from print_partner.core.print_progress import (
    copy_progress_on_duplicate,
    ensure_profile_progress,
    ensure_progress_rows,
)
from print_partner.core.scanner import scan_repo
from print_partner.db.models import BuildProfile, Part, ProfileLayer, Project
from print_partner.db.session import (
    MergeWouldWipeProfileError,
    get_profile_layers,
    get_profile_parts,
    row_to_merge_part,
    save_merge_result,
)


def rename_profile(session: Session, profile_id: int, new_name: str) -> None:
    name = new_name.strip()
    if not name:
        raise ValueError("Profile name is required")
    existing = session.scalars(
        select(BuildProfile).where(BuildProfile.name == name, BuildProfile.id != profile_id)
    ).first()
    if existing:
        raise ValueError(f"Profile already exists: {name}")
    profile = session.get(BuildProfile, profile_id)
    if not profile:
        raise ValueError("Profile not found")
    profile.name = name


def delete_profile(session: Session, profile_id: int) -> None:
    profile = session.get(BuildProfile, profile_id)
    if profile:
        session.delete(profile)


def duplicate_profile(session: Session, profile_id: int, new_name: str) -> int:
    name = new_name.strip()
    if not name:
        raise ValueError("Profile name is required")
    if session.scalars(select(BuildProfile).where(BuildProfile.name == name)).first():
        raise ValueError(f"Profile already exists: {name}")
    source = session.get(BuildProfile, profile_id)
    if not source:
        raise ValueError("Profile not found")

    old_parts = list(get_profile_parts(session, profile_id))
    new_profile = BuildProfile(name=name, order_number=source.order_number)
    session.add(new_profile)
    session.flush()

    for layer in get_profile_layers(session, profile_id):
        session.add(
            ProfileLayer(
                profile_id=new_profile.id,
                layer_order=layer.layer_order,
                layer_type=layer.layer_type,
                project_id=layer.project_id,
            )
        )

    for old in old_parts:
        session.add(
            Part(
                profile_id=new_profile.id,
                match_key=old.match_key,
                relative_path=old.relative_path,
                filename=old.filename,
                source_layer=old.source_layer,
                status=old.status,
                role=old.role,
                filament_color_id=old.filament_color_id,
                filament_custom_hex=old.filament_custom_hex,
                quantity_auto=old.quantity_auto,
                quantity_override=old.quantity_override,
                quantity_effective=old.quantity_effective,
                included=old.included,
                notes=old.notes,
                github_blob_url=old.github_blob_url,
                geometry_same=old.geometry_same,
            )
        )
    session.flush()
    new_parts = list(get_profile_parts(session, new_profile.id))
    copy_progress_on_duplicate(session, old_parts, new_parts)
    ensure_profile_progress(session, new_profile.id)
    return new_profile.id


def set_profile_order_number(
    session: Session, profile_id: int, order_number: str | None
) -> None:
    profile = session.get(BuildProfile, profile_id)
    if not profile:
        raise ValueError("Profile not found")
    profile.order_number = (order_number or "").strip() or None


def _existing_merge_map(session: Session, profile_id: int) -> dict[str, MergePart]:
    return {p.match_key: row_to_merge_part(p) for p in get_profile_parts(session, profile_id)}


def recompute_profile(
    session: Session,
    profile_id: int,
    *,
    cancel_check=None,
) -> dict:
    """Scan layers, merge, save. Returns debug info dict."""
    layer_scans: list[tuple[str, list]] = []
    layer_debug: list[dict] = []
    existing = _existing_merge_map(session, profile_id)
    layers = get_profile_layers(session, profile_id)
    for layer in layers:
        if cancel_check and cancel_check():
            return {
                "layer_debug": layer_debug,
                "merged": False,
                "reason": "cancelled",
            }
        if layer.project_id is None:
            layer_debug.append(
                {
                    "layer_type": layer.layer_type,
                    "project_id": layer.project_id,
                    "skipped": "no_project",
                }
            )
            continue
        proj = session.get(Project, layer.project_id)
        if not proj or not proj.local_path:
            layer_debug.append(
                {
                    "layer_type": layer.layer_type,
                    "project_id": layer.project_id,
                    "skipped": "no_local_path",
                }
            )
            continue
        label = f"{layer.layer_type}:{proj.name}"
        rules = import_rules_for_project(proj.imported_paths)
        scanned = scan_repo(Path(proj.local_path), label, import_rules=rules)
        layer_scans.append((label, scanned))
        layer_debug.append(
            {
                "label": label,
                "local_path": proj.local_path,
                "stl_count": len(scanned),
            }
        )
    if not layer_scans:
        return {
            "layer_debug": layer_debug,
            "merged": False,
            "reason": "no_layers",
        }
    total_scanned = sum(len(parts) for _, parts in layer_scans)
    if total_scanned == 0:
        return {
            "layer_debug": layer_debug,
            "merged": False,
            "reason": "no_stls",
            "message": (
                "No STL files matched import rules for any layer.\n\n"
                "On the Projects tab, select each repo and use Import files… "
                "to choose which folders to include (or leave rules empty to import all)."
            ),
        }
    try:
        result = merge_layers(layer_scans, existing)
        save_merge_result(session, profile_id, result)
    except MergeWouldWipeProfileError as exc:
        return {
            "layer_debug": layer_debug,
            "merged": False,
            "reason": "would_wipe",
            "message": str(exc),
        }
    ensure_profile_progress(session, profile_id)
    return {"layer_debug": layer_debug, "merged": True, "part_count": len(result.parts)}


def restore_profile_from_template(
    session: Session, target_profile_id: int, source_profile_id: int
) -> int:
    """
    Copy all parts and print progress from source profile onto target.
    Used when target was accidentally wiped but a duplicate profile still has data.
    """
    from sqlalchemy import delete

    target = session.get(BuildProfile, target_profile_id)
    source = session.get(BuildProfile, source_profile_id)
    if not target or not source:
        raise ValueError("Profile not found")
    source_parts = list(get_profile_parts(session, source_profile_id))
    if not source_parts:
        raise ValueError("Source profile has no parts to restore")

    session.execute(delete(Part).where(Part.profile_id == target_profile_id))
    session.flush()

    for old in source_parts:
        new_part = Part(
            profile_id=target_profile_id,
            match_key=old.match_key,
            relative_path=old.relative_path,
            filename=old.filename,
            source_layer=old.source_layer,
            status=old.status,
            role=old.role,
            filament_color_id=old.filament_color_id,
            filament_custom_hex=old.filament_custom_hex,
            quantity_auto=old.quantity_auto,
            quantity_override=old.quantity_override,
            quantity_effective=old.quantity_effective,
            included=old.included,
            notes=old.notes or "",
            github_blob_url=old.github_blob_url,
            geometry_same=old.geometry_same,
        )
        session.add(new_part)
    session.flush()

    new_parts = list(get_profile_parts(session, target_profile_id))
    copy_progress_on_duplicate(session, source_parts, new_parts)
    for part in new_parts:
        ensure_progress_rows(session, part)
    ensure_profile_progress(session, target_profile_id)
    return len(new_parts)


def set_base_project(session: Session, profile_id: int, project_id: int) -> None:
    session.execute(
        delete(ProfileLayer).where(
            ProfileLayer.profile_id == profile_id,
            ProfileLayer.layer_type == "base",
        )
    )
    session.add(
        ProfileLayer(
            profile_id=profile_id,
            layer_order=0,
            layer_type="base",
            project_id=project_id,
        )
    )


def add_addon_project(session: Session, profile_id: int, project_id: int) -> None:
    layers = get_profile_layers(session, profile_id)
    order = max((l.layer_order for l in layers), default=-1) + 1
    session.add(
        ProfileLayer(
            profile_id=profile_id,
            layer_order=order,
            layer_type="addon",
            project_id=project_id,
        )
    )


def replace_layer_project(
    session: Session, layer_id: int, project_id: int
) -> None:
    layer = session.get(ProfileLayer, layer_id)
    if not layer:
        raise ValueError("Layer not found")
    layer.project_id = project_id


def _renumber_layers(session: Session, profile_id: int) -> None:
    layers = get_profile_layers(session, profile_id)
    for i, layer in enumerate(layers):
        layer.layer_order = i


def remove_layer(session: Session, layer_id: int) -> None:
    layer = session.get(ProfileLayer, layer_id)
    if not layer:
        raise ValueError("Layer not found")
    if layer.layer_type == "base":
        raise ValueError("Cannot remove base layer")
    profile_id = layer.profile_id
    session.delete(layer)
    _renumber_layers(session, profile_id)
