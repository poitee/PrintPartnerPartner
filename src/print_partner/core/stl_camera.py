"""Shared camera framing for PyVista STL renders (preview + thumbnails)."""

from __future__ import annotations

# Square PNG output size (PyVista window and stl-thumb -s).
THUMB_PNG_SIZE = 384

# Values < 1 zoom out in PyVista, leaving margin so parts are not clipped at edges.
THUMB_CAMERA_PADDING = 0.88
PREVIEW_CAMERA_PADDING = 0.90


def fit_mesh_in_view(plotter, *, padding: float = THUMB_CAMERA_PADDING) -> None:
    """Isometric view with padding so the full mesh fits in the frame."""
    plotter.view_isometric()
    plotter.reset_camera()
    if padding > 0 and abs(padding - 1.0) > 1e-6:
        plotter.camera.zoom(padding)
    plotter.reset_camera_clipping_range()
