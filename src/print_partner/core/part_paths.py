"""Resolve on-disk STL paths for profile parts."""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.orm import Session

from print_partner.core.filament_color_resolve import resolve_part_filament_hex
from print_partner.db.models import Part, Project
from print_partner.db.session import get_profile_layers


def layer_label(session: Session, layer) -> str:
    if layer.project_id is None:
        return layer.layer_type
    proj = session.get(Project, layer.project_id)
    return f"{layer.layer_type}:{proj.name}" if proj else layer.layer_type


@dataclass
class ProfileStlIndex:
    """Cached layer label → repo root for fast STL path lookup."""

    by_layer: dict[str, Path] = field(default_factory=dict)
    fallback_roots: list[Path] = field(default_factory=list)


def build_profile_stl_index(session: Session, profile_id: int) -> ProfileStlIndex:
    by_layer: dict[str, Path] = {}
    fallback: list[Path] = []
    seen: set[Path] = set()
    for layer in get_profile_layers(session, profile_id):
        if layer.project_id is None:
            continue
        proj = session.get(Project, layer.project_id)
        if not proj or not proj.local_path:
            continue
        root = Path(proj.local_path)
        by_layer[layer_label(session, layer)] = root
        if root not in seen:
            seen.add(root)
            fallback.append(root)
    return ProfileStlIndex(by_layer=by_layer, fallback_roots=fallback)


def resolve_part_stl_path_indexed(part: Part, index: ProfileStlIndex) -> Path | None:
    if part.source_layer and part.source_layer in index.by_layer:
        candidate = index.by_layer[part.source_layer] / part.relative_path
        if candidate.is_file():
            return candidate
    for root in index.fallback_roots:
        candidate = root / part.relative_path
        if candidate.is_file():
            return candidate
    return None


def resolve_part_stl_path(session: Session, part: Part) -> Path | None:
    """Resolve STL file using part.source_layer when possible."""
    index = build_profile_stl_index(session, part.profile_id)
    return resolve_part_stl_path_indexed(part, index)


def thumbnail_jobs_for_profile(session: Session, profile_id: int) -> list[tuple[Path, str, str | None]]:
    """Included parts with resolvable STL: (path, role, mesh_hex)."""
    index = build_profile_stl_index(session, profile_id)
    jobs: list[tuple[Path, str, str | None]] = []
    for part in session.scalars(select(Part).where(Part.profile_id == profile_id)).all():
        if not part.included:
            continue
        stl = resolve_part_stl_path_indexed(part, index)
        if stl is None:
            continue
        mesh_hex = resolve_part_filament_hex(part)
        jobs.append((stl, part.role, mesh_hex))
    return jobs
