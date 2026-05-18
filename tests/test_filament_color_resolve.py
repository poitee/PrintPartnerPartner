from print_partner.core.filament_color_resolve import (
    effective_filament_hex,
    infer_hex_from_display_name,
    is_weak_swatch_hex,
)


def test_is_weak_swatch_hex_detects_placeholder_grey():
    assert is_weak_swatch_hex("#e1e1e1")
    assert is_weak_swatch_hex("#888888")
    assert not is_weak_swatch_hex("#c41230")


def test_infer_hex_from_display_name():
    assert infer_hex_from_display_name("Voron Red", "ABS Matte") == "#c41230"
    assert infer_hex_from_display_name("Hot Pink") == "#ff1493"
    assert infer_hex_from_display_name("British Racing Green") == "#004225"


def test_effective_filament_hex_prefers_name_when_swatch_muddy():
    assert effective_filament_hex("#e1e1e1", "Voron Red", "PLA") == "#c41230"
    assert effective_filament_hex("#dcad9f", "Hot Pink", "ABS") == "#ff1493"
    assert effective_filament_hex("#2563eb", "Ocean Blue", "PLA") == "#2563eb"
