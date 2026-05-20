"""Resolve usable filament hex from swatch samples and color names."""

from __future__ import annotations

import re

from print_partner.core.mesh_color import normalize_mesh_hex

# Voron red — default when no catalog color or custom hex is assigned.
UNASSIGNED_FILAMENT_HEX = "#c41230"

# Placeholder / failed swatch averages (cardboard + white background).
_WEAK_EXACT = frozenset(
    {
        "#888888",
        "#e1e1e1",
        "#e0e0e0",
        "#d8d8d8",
        "#cccccc",
        "#c0c0c0",
        "#bfbfbf",
    }
)

# (pattern, hex) — most specific names first.
_NAME_HINTS: list[tuple[re.Pattern[str], str]] = [
    (re.compile(r"british\s*racing\s*green", re.I), "#004225"),
    (re.compile(r"bloody\s*murder|blood\s*orange", re.I), "#e85d04"),
    (re.compile(r"burnt\s*orange", re.I), "#cc5500"),
    (re.compile(r"voron\s*red", re.I), "#c41230"),
    (re.compile(r"hot\s*pink", re.I), "#ff1493"),
    (re.compile(r"galactic\s*black", re.I), "#1a1a22"),
    (re.compile(r"grey\s*abyss|gray\s*abyss", re.I), "#3a3a42"),
    (re.compile(r"\bgold\b", re.I), "#d4af37"),
    (re.compile(r"\bcopper\b", re.I), "#b87333"),
    (re.compile(r"\bbronze\b", re.I), "#cd7f32"),
    (re.compile(r"\bsilver\b", re.I), "#a8a9ad"),
    (re.compile(r"\bwhite\b", re.I), "#f2f2f2"),
    (re.compile(r"\bblack\b", re.I), "#1a1a1a"),
    (re.compile(r"\bnavy\b", re.I), "#001f3f"),
    (re.compile(r"\bteal\b", re.I), "#008080"),
    (re.compile(r"\bcyan\b", re.I), "#00bcd4"),
    (re.compile(r"\bmagenta\b", re.I), "#ff00ff"),
    (re.compile(r"\bpurple\b", re.I), "#800080"),
    (re.compile(r"\bviolet\b", re.I), "#8f00ff"),
    (re.compile(r"\bindigo\b", re.I), "#4b0082"),
    (re.compile(r"\blime\b", re.I), "#32cd32"),
    (re.compile(r"\bolive\b", re.I), "#808000"),
    (re.compile(r"\bbeige\b", re.I), "#dcc8a8"),
    (re.compile(r"\btan\b", re.I), "#d2b48c"),
    (re.compile(r"\bbrown\b", re.I), "#8b4513"),
    (re.compile(r"\borange\b", re.I), "#ff8c00"),
    (re.compile(r"\byellow\b", re.I), "#ffd700"),
    (re.compile(r"\bpink\b", re.I), "#ff69b4"),
    (re.compile(r"\bred\b", re.I), "#d62828"),
    (re.compile(r"\bblue\b", re.I), "#2563eb"),
    (re.compile(r"\bgreen\b", re.I), "#2d6a4f"),
    (re.compile(r"\bgrey\b|\bgray\b", re.I), "#808080"),
]


def is_weak_swatch_hex(hex_color: str | None) -> bool:
    """True when a sampled swatch is mostly background grey, not filament."""
    normalized = normalize_mesh_hex(hex_color)
    if not normalized:
        return True
    if normalized in _WEAK_EXACT:
        return True
    r = int(normalized[1:3], 16)
    g = int(normalized[3:5], 16)
    b = int(normalized[5:7], 16)
    spread = max(r, g, b) - min(r, g, b)
    if spread < 28:
        return True
    # Tan / cardboard product-photo averages (red-dominant, low saturation).
    if r > g > b and r > 160 and g > 130 and b > 110 and spread < 85:
        return True
    return False


def infer_hex_from_display_name(display_name: str, product_line: str = "") -> str | None:
    """Best-effort hex from marketing color name when swatch sampling fails."""
    text = f"{display_name} {product_line}".strip()
    if not text:
        return None
    for pattern, hex_val in _NAME_HINTS:
        if pattern.search(text):
            return hex_val
    return None


def effective_filament_hex(
    hex_color: str | None,
    display_name: str = "",
    product_line: str = "",
) -> str | None:
    """
    Return a saturated hex suitable for mesh preview/thumbnails.
    Prefers a good swatch sample; falls back to name inference.
    """
    sampled = normalize_mesh_hex(hex_color)
    inferred = infer_hex_from_display_name(display_name, product_line)
    if sampled and not is_weak_swatch_hex(sampled):
        return sampled
    if inferred:
        return normalize_mesh_hex(inferred)
    return sampled


def resolve_part_filament_hex(part) -> str:
    """
    Resolved mesh/export hex for a Part: custom hex, then catalog effective, then unset red.
    """
    custom = normalize_mesh_hex(getattr(part, "filament_custom_hex", None))
    if custom:
        return custom
    filament_id = getattr(part, "filament_color_id", None)
    if filament_id:
        from print_partner.core.ambrosia_catalog import get_color_by_id

        color = get_color_by_id(filament_id)
        if color:
            resolved = effective_filament_hex(
                color.hex, color.display_name, color.product_line
            )
            normalized = normalize_mesh_hex(resolved)
            if normalized:
                return normalized
    return UNASSIGNED_FILAMENT_HEX
