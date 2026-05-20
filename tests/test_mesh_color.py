from print_partner.core.mesh_color import (
    boost_dark_hex_for_thumbnail,
    mesh_color_for_stl_thumb,
    normalize_mesh_hex,
    resolve_mesh_color,
    resolve_thumbnail_mesh_color,
)


def test_resolve_mesh_color_prefers_filament_hex():
    assert resolve_mesh_color("accent", "#ff0000") == "#ff0000"
    assert resolve_mesh_color("accent", "00ff00") == "#00ff00"


def test_resolve_mesh_color_falls_back_to_role():
    c = resolve_mesh_color("accent", None)
    assert c == "#880000"


def test_boost_dark_hex_for_thumbnail():
    assert boost_dark_hex_for_thumbnail("#101010") == "#444444"
    assert boost_dark_hex_for_thumbnail("#ff0000") == "#ff0000"


def test_resolve_thumbnail_mesh_color_boosts_black_filament():
    assert resolve_thumbnail_mesh_color("primary", "#000000") == "#444444"
    assert resolve_thumbnail_mesh_color("primary", "#606060") == "#606060"


def test_normalize_mesh_hex():
    assert normalize_mesh_hex("#FF00AA") == "#ff00aa"
    assert normalize_mesh_hex("bad") is None


def test_mesh_color_for_stl_thumb_puts_filament_on_diffuse():
    args = mesh_color_for_stl_thumb("#ff0000")
    assert args[0] == "-m"
    assert args[2] == "ff0000"  # diffuse = filament body color
