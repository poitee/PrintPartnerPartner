from pathlib import Path

from print_partner.core.thumbnails import (
    global_thumbnail_path,
    invalidate_global_thumbnails,
    thumbnail_cache_digest,
    thumbnail_cache_path,
)


def test_thumbnail_cache_path_unique_per_file(tmp_path: Path):
    a = tmp_path / "a" / "part_x1.stl"
    b = tmp_path / "b" / "part_x1.stl"
    a.parent.mkdir(parents=True)
    b.parent.mkdir(parents=True)
    a.write_text("solid")
    b.write_text("solid")
    pa = thumbnail_cache_path(a, tmp_path / "export")
    pb = thumbnail_cache_path(b, tmp_path / "export")
    assert pa != pb
    assert pa.name.endswith(".png")


def test_thumbnail_cache_digest_changes_with_role_and_hex(tmp_path: Path):
    stl = tmp_path / "part.stl"
    stl.write_text("solid")
    d1 = thumbnail_cache_digest(stl, "primary", None)
    d2 = thumbnail_cache_digest(stl, "accent", None)
    d3 = thumbnail_cache_digest(stl, "primary", "#ff0000")
    assert d1 != d2
    assert d1 != d3
    assert global_thumbnail_path(stl, "primary", None).name == f"{d1}.png"


def test_invalidate_global_thumbnails_removes_variants(tmp_path):
    stl = tmp_path / "part.stl"
    stl.write_text("solid")
    role_png = global_thumbnail_path(stl, "primary", None)
    color_png = global_thumbnail_path(stl, "primary", "#ff0000")
    role_png.parent.mkdir(parents=True, exist_ok=True)
    role_png.write_bytes(b"role")
    color_png.write_bytes(b"color")
    invalidate_global_thumbnails(stl, "primary", "#ff0000", all_variants=True)
    assert not role_png.is_file()
    assert not color_png.is_file()
