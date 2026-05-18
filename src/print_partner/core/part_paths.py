"""Resolve on-disk STL paths for profile parts."""

from __future__ import annotations

from pathlib import Path

from sqlalchemy import select
from sqlalchemy.orm import Session

from print_partner.core.ambrosia_catalog import resolve_filament_hex
from print_partner.db.models import Part, Project
from print_partner.db.session import get_profile_layers


def layer_label(session: Session, layer) -> str:
    if layer.project_id is None:
        return layer.layer_type
    proj = session.get(Project, layer.project_id)
    return f"{layer.layer_type}:{proj.name}" if proj else layer.layer_type


def resolve_part_stl_path(session: Session, part: Part) -> Path | None:
    """Resolve STL file using part.source_layer when possible."""
    layers = get_profile_layers(session, part.profile_id)
    if part.source_layer:
        for layer in layers:
            if layer.project_id is None:
                continue
            if layer_label(session, layer) != part.source_layer:
                continue
            proj = session.get(Project, layer.project_id)
            if proj and proj.local_path:
                candidate = Path(proj.local_path) / part.relative_path
                if candidate.is_file():
                    return candidate
    for layer in layers:
        if layer.project_id is None:
            continue
        proj = session.get(Project, layer.project_id)
        if proj and proj.local_path:
            candidate = Path(proj.local_path) / part.relative_path
            if candidate.is_file():
                return candidate
    return None


def thumbnail_jobs_for_profile(session: Session, profile_id: int) -> list[tuple[Path, str, str | None]]:
    """Included parts with resolvable STL: (path, role, mesh_hex)."""
    jobs: list[tuple[Path, str, str | None]] = []
    for part in session.scalars(select(Part).where(Part.profile_id == profile_id)).all():
        if not part.included:
            continue
        stl = resolve_part_stl_path(session, part)
        if stl is None:
            continue
        mesh_hex = resolve_filament_hex(part.filament_color_id, part.role)
        jobs.append((stl, part.role, mesh_hex))
    return jobs
