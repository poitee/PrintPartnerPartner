"""STL preview render settings and backend selection."""

from __future__ import annotations

from pathlib import Path
from unittest.mock import MagicMock, patch

from print_partner.core import stl_preview_render as preview
from print_partner.core.thumbnails import THUMB_SHOW_EDGES


def test_preview_show_edges_matches_thumbnails():
    assert preview.PREVIEW_SHOW_EDGES is THUMB_SHOW_EDGES
    assert preview.PREVIEW_SHOW_EDGES is True


def test_render_stl_preview_png_uses_stl_thumb_when_available(tmp_path: Path):
    stl = tmp_path / "part.stl"
    stl.write_bytes(b"")
    out = tmp_path / "out.png"

    with patch.object(preview, "_preview_stl_thumb", return_value=True) as thumb:
        with patch.object(preview, "_preview_pyvista") as pv:
            result = preview.render_stl_preview_png(stl, out, "primary", None)

    assert result.ok
    thumb.assert_called_once()
    pv.assert_not_called()


def test_preview_pyvista_enables_edges_when_thumbnails_do(tmp_path: Path):
    stl = tmp_path / "part.stl"
    stl.write_bytes(b"")
    out = tmp_path / "out.png"
    mesh = MagicMock()
    mesh.n_points = 100

    plotter = MagicMock()
    pv_mod = MagicMock()
    pv_mod.Plotter.return_value = plotter
    pv_mod.read.return_value = mesh

    out.touch()
    with patch.object(preview, "_load_mesh", return_value=mesh):
        with patch.object(preview, "_simplify_mesh", return_value=mesh):
            with patch.object(preview, "vtk_lock"):
                with patch.dict("sys.modules", {"pyvista": pv_mod}):
                    result = preview._preview_pyvista(stl, out, "primary", None)

    assert result.ok
    plotter.add_mesh.assert_called_once()
    kwargs = plotter.add_mesh.call_args.kwargs
    assert kwargs["show_edges"] is True
    assert kwargs.get("smooth_shading") is False
