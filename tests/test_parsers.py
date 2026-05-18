"""Parser unit tests."""

from print_partner.core.parsers import PartRole, parse_quantity, parse_role, parse_stl_path


def test_accent_quantity():
    p = parse_stl_path("parts/[a]_foo_x4.stl")
    assert p.role == PartRole.ACCENT
    assert p.quantity == 4
    assert "foo" in p.part_slug.lower()


def test_primary_default():
    p = parse_stl_path("body/plate.stl")
    assert p.role == PartRole.PRIMARY
    assert p.quantity == 1


def test_clear_in_path():
    p = parse_stl_path("[c]/lens.stl")
    assert p.role == PartRole.CLEAR


def test_opaque_marker():
    p = parse_stl_path("shell/[o]_cover.stl")
    assert p.role == PartRole.OPAQUE


def test_quantity_space_variant():
    assert parse_quantity("widget x2.stl") == 2


def test_role_from_filename_only():
    assert parse_role("[a]bracket.stl") == PartRole.ACCENT
