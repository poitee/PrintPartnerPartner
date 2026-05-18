"""Resolve mesh display color from Voron role and optional filament hex."""

from __future__ import annotations

from print_partner.core.parsers import PartRole
from print_partner.core.thumbnails import ROLE_MESH_RGB


def normalize_mesh_hex(hex_color: str | None) -> str | None:
    """Canonical #rrggbb for cache keys and rendering."""
    if not hex_color:
        return None
    h = hex_color.strip().lstrip("#").lower()
    if len(h) != 6:
        return None
    try:
        int(h, 16)
    except ValueError:
        return None
    return f"#{h}"


def _dim_hex(rgb: str, factor: float) -> str:
    r = int(rgb[0:2], 16)
    g = int(rgb[2:4], 16)
    b = int(rgb[4:6], 16)
    r = max(0, min(255, int(r * factor)))
    g = max(0, min(255, int(g * factor)))
    b = max(0, min(255, int(b * factor)))
    return f"{r:02x}{g:02x}{b:02x}"


def resolve_mesh_color(role: str, filament_hex: str | None = None) -> str:
    normalized = normalize_mesh_hex(filament_hex)
    if normalized:
        return normalized
    return ROLE_MESH_RGB.get(role, ROLE_MESH_RGB[PartRole.PRIMARY.value])


def mesh_color_for_stl_thumb(hex_color: str) -> list[str]:
    """stl-thumb -m ambient diffuse specular (Phong); diffuse is the visible body color."""
    h = normalize_mesh_hex(hex_color)
    if not h:
        h = "#888888"
    rgb = h.lstrip("#")
    ambient = _dim_hex(rgb, 0.55)
    diffuse = rgb
    specular = "ffffff"
    return ["-m", ambient, diffuse, specular]
