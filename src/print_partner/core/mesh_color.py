"""Resolve mesh display color from Voron role and optional filament hex."""

from __future__ import annotations

from print_partner.core.parsers import PartRole
from print_partner.core.thumbnails import ROLE_MESH_RGB

# Thumbnail-only: lift very dark colors so parts read on white (screen + print).
_THUMB_MIN_CHANNEL = 0x44


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


def boost_dark_hex_for_thumbnail(hex_color: str) -> str:
    """Raise very dark filament/role colors for thumbnail visibility (not for picker UI)."""
    normalized = normalize_mesh_hex(hex_color)
    if not normalized:
        return "#888888"
    r = int(normalized[1:3], 16)
    g = int(normalized[3:5], 16)
    b = int(normalized[5:7], 16)
    peak = max(r, g, b)
    if peak >= _THUMB_MIN_CHANNEL:
        return normalized
    if peak == 0:
        c = f"{_THUMB_MIN_CHANNEL:02x}"
        return f"#{c}{c}{c}"
    scale = _THUMB_MIN_CHANNEL / peak
    r = min(255, int(r * scale))
    g = min(255, int(g * scale))
    b = min(255, int(b * scale))
    return f"#{r:02x}{g:02x}{b:02x}"


def resolve_mesh_color(role: str, filament_hex: str | None = None) -> str:
    normalized = normalize_mesh_hex(filament_hex)
    if normalized:
        return normalized
    return ROLE_MESH_RGB.get(role, ROLE_MESH_RGB[PartRole.PRIMARY.value])


def resolve_thumbnail_mesh_color(role: str, filament_hex: str | None = None) -> str:
    """Mesh color for PNG thumbnails — same sources as preview but dark colors are lifted."""
    return boost_dark_hex_for_thumbnail(resolve_mesh_color(role, filament_hex))


def mesh_color_for_stl_thumb(hex_color: str) -> list[str]:
    """stl-thumb -m ambient diffuse specular (Phong); diffuse is the visible body color."""
    boosted = boost_dark_hex_for_thumbnail(hex_color)
    rgb = boosted.lstrip("#")
    ambient = _dim_hex(rgb, 0.65)
    diffuse = rgb
    specular = "ffffff"
    return ["-m", ambient, diffuse, specular]
