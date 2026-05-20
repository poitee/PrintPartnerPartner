from pathlib import Path

from print_partner.core.thumbnails import (
    THUMB_PNG_SIZE,
    stl_thumb_command,
)


def test_stl_thumb_command_includes_size_and_material(tmp_path: Path):
    stl = tmp_path / "part.stl"
    stl.write_text("solid")
    out = tmp_path / "out.png"
    cmd = stl_thumb_command(stl, out, "accent", "#ff0000")
    assert cmd[0] == "stl-thumb"
    assert "-s" in cmd
    assert str(THUMB_PNG_SIZE) in cmd
    assert "-m" in cmd
    assert str(stl) in cmd
    assert str(out) in cmd
