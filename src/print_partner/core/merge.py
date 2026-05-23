"""Layered merge engine for build profiles."""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path

import trimesh
from rapidfuzz import fuzz

from print_partner.core.scanner import ScannedPart, normalize_match_key


@dataclass
class MergePart:
    match_key: str
    relative_path: str
    filename: str
    source_layer: str
    status: str  # base|added|replaced|excluded|conflict
    role: str
    quantity_auto: int
    part_slug: str
    included: bool = True
    quantity_override: int | None = None
    notes: str = ""
    geometry_same: bool | None = None
    absolute_path: Path | None = None
    filament_color_id: str | None = None
    filament_display: str = ""
    filament_hex: str | None = None
    filament_swatch_url: str = ""

    @property
    def quantity_effective(self) -> int:
        if self.quantity_override is not None:
            return self.quantity_override
        return self.quantity_auto


@dataclass
class MergeResult:
    parts: list[MergePart]
    duplicate_hints: list[tuple[str, str, float]] = field(default_factory=list)


def _scanned_to_merge(part: ScannedPart, status: str, source: str) -> MergePart:
    return MergePart(
        match_key=part.match_key,
        relative_path=part.relative_path,
        filename=part.filename,
        source_layer=source,
        status=status,
        role=part.role,
        quantity_auto=part.quantity,
        part_slug=part.part_slug,
        absolute_path=part.absolute_path,
    )


def compare_geometry(path_a: Path | None, path_b: Path | None) -> bool | None:
    if path_a is None or path_b is None:
        return None
    if not path_a.is_file() or not path_b.is_file():
        return None
    try:
        mesh_a = trimesh.load(path_a, force="mesh")
        mesh_b = trimesh.load(path_b, force="mesh")
        if not isinstance(mesh_a, trimesh.Trimesh) or not isinstance(mesh_b, trimesh.Trimesh):
            return None
        return mesh_a.vertices.shape == mesh_b.vertices.shape and (
            (mesh_a.vertices - mesh_b.vertices).max() < 1e-4
        )
    except Exception:
        return None


def _find_duplicate_hints(parts: list[MergePart], threshold: float = 85.0) -> list[tuple[str, str, float]]:
    hints: list[tuple[str, str, float]] = []
    slugs = [(p.part_slug, p.match_key) for p in parts if p.included]
    seen: set[tuple[str, str]] = set()
    for i, (slug_a, key_a) in enumerate(slugs):
        for slug_b, key_b in slugs[i + 1 :]:
            if slug_a == slug_b and key_a != key_b:
                continue
            score = fuzz.ratio(slug_a.lower(), slug_b.lower())
            if score >= threshold:
                pair = tuple(sorted((key_a, key_b)))
                if pair not in seen:
                    seen.add(pair)  # type: ignore[arg-type]
                    hints.append((key_a, key_b, score))
    return hints


def merge_layers(
    layer_scans: list[tuple[str, list[ScannedPart]]],
    existing: dict[str, MergePart] | None = None,
) -> MergeResult:
    """
    Apply layers in order: base seeds, addon adds/replaces.
    existing: prior parts keyed by match_key to preserve overrides.
    """
    prior = existing or {}
    merged: dict[str, MergePart] = {}
    slug_index: dict[str, str] = {}

    for layer_idx, (layer_name, scanned) in enumerate(layer_scans):
        is_base = layer_idx == 0
        for part in scanned:
            key = normalize_match_key(part.relative_path)
            prev = merged.get(key)
            old_prior = prior.get(key)

            if prev is None and not is_base:
                status = "added"
            elif prev is None:
                status = "base"
            else:
                status = "replaced"

            mp = _scanned_to_merge(part, status, layer_name)
            if old_prior:
                mp.quantity_override = old_prior.quantity_override
                mp.notes = old_prior.notes
                mp.included = old_prior.included
                if not old_prior.included:
                    mp.status = "excluded"

            if prev and prev.absolute_path and part.absolute_path:
                mp.geometry_same = compare_geometry(prev.absolute_path, part.absolute_path)

            merged[key] = mp

            other_key = slug_index.get(part.part_slug)
            if other_key and other_key != key:
                merged[key].status = "conflict"
                if other_key in merged:
                    merged[other_key].status = "conflict"
            else:
                slug_index[part.part_slug] = key

    parts = list(merged.values())
    hints = _find_duplicate_hints(parts)
    return MergeResult(parts=parts, duplicate_hints=hints)
