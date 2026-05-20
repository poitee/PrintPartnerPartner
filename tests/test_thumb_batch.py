from pathlib import Path
from unittest.mock import patch

from print_partner.core.thumbnails import (
    THUMB_BATCH_SIZE,
    generate_thumbnails_batch_subprocess,
)


def test_thumb_batch_size_sane():
    assert THUMB_BATCH_SIZE >= 8


def test_batch_subprocess_invokes_batch_cli(tmp_path: Path):
    stl = tmp_path / "a.stl"
    stl.write_text("solid")
    out = tmp_path / "out.png"
    calls: list[list[str]] = []

    def fake_run(cmd, **kwargs):
        calls.append(cmd)
        out.write_bytes(b"png")
        class R:
            returncode = 0

        return R()

    with patch("print_partner.core.thumbnails.subprocess.run", fake_run):
        result = generate_thumbnails_batch_subprocess([(stl, out, "primary", None)])
    assert result[out] is True
    assert any("thumb_batch_cli" in str(c) for c in calls)
