"""Offscreen STL preview rendering (no Qt VTK widget — avoids macOS crashes)."""

from __future__ import annotations

import shutil
import subprocess
from dataclasses import dataclass
from pathlib import Path

from print_partner.core.mesh_color import resolve_mesh_color
from print_partner.core.stl_camera import PREVIEW_CAMERA_PADDING, fit_mesh_in_view
from print_partner.core.thumbnails import THUMB_EDGE_COLOR, THUMB_SHOW_EDGES, stl_thumb_command
from print_partner.core.vtk_lock import vtk_lock

_PREVIEW_POINT_LIMIT = 80_000
_PREVIEW_SIZE = (640, 480)
PREVIEW_PNG_SIZE = max(_PREVIEW_SIZE)
# Matches thumbnail policy; kept as alias for docs/tests.
PREVIEW_SHOW_EDGES = THUMB_SHOW_EDGES


@dataclass
class PreviewRenderResult:
    ok: bool
    points: int = 0
    error: str = ""


def _load_mesh(stl_path: Path, point_limit: int = _PREVIEW_POINT_LIMIT):
    import pyvista as pv

    try:
        import trimesh

        loaded = trimesh.load(str(stl_path), force="mesh")
        if isinstance(loaded, trimesh.Scene):
            if not loaded.geometry:
                return None
            loaded = trimesh.util.concatenate(tuple(loaded.geometry.values()))
        return pv.wrap(loaded)
    except Exception:
        return pv.read(str(stl_path))


def _simplify_mesh(mesh, limit: int = _PREVIEW_POINT_LIMIT):
    n = mesh.n_points
    if n > limit:
        try:
            ratio = 1.0 - (limit / n)
            mesh = mesh.decimate(max(0.01, min(0.95, ratio)))
        except Exception:
            pass
    return mesh


def _preview_stl_thumb(
    stl_path: Path,
    output_png: Path,
    role: str,
    mesh_hex: str | None,
) -> bool:
    if not shutil.which("stl-thumb"):
        return False
    try:
        result = subprocess.run(
            stl_thumb_command(stl_path, output_png, role, mesh_hex, size=PREVIEW_PNG_SIZE),
            check=False,
            capture_output=True,
            timeout=120,
        )
        return result.returncode == 0 and output_png.is_file()
    except (OSError, subprocess.SubprocessError):
        return False


def _preview_pyvista(
    stl_path: Path,
    output_png: Path,
    role: str,
    mesh_hex: str | None,
) -> PreviewRenderResult:
    import pyvista as pv

    mesh = _load_mesh(stl_path)
    if mesh is None:
        return PreviewRenderResult(ok=False, error="empty mesh")
    points_before = int(mesh.n_points)
    mesh = _simplify_mesh(mesh, limit=_PREVIEW_POINT_LIMIT)
    color = resolve_mesh_color(role, mesh_hex)
    output_png.parent.mkdir(parents=True, exist_ok=True)
    with vtk_lock():
        plotter = pv.Plotter(off_screen=True, window_size=list(_PREVIEW_SIZE))
        plotter.set_background("white")
        plotter.add_mesh(
            mesh,
            color=color,
            show_edges=PREVIEW_SHOW_EDGES,
            edge_color=THUMB_EDGE_COLOR,
            smooth_shading=not PREVIEW_SHOW_EDGES,
        )
        fit_mesh_in_view(plotter, padding=PREVIEW_CAMERA_PADDING)
        plotter.screenshot(str(output_png))
        plotter.close()
    if not output_png.is_file():
        return PreviewRenderResult(ok=False, points=points_before, error="screenshot failed")
    return PreviewRenderResult(ok=True, points=int(mesh.n_points), error="")


def render_stl_preview_png(
    stl_path: Path,
    output_png: Path,
    role: str = "primary",
    mesh_hex: str | None = None,
) -> PreviewRenderResult:
    """Render STL to PNG; stl-thumb when available, else PyVista offscreen."""
    if not stl_path.is_file():
        return PreviewRenderResult(ok=False, error="file not found")

    output_png.parent.mkdir(parents=True, exist_ok=True)
    if _preview_stl_thumb(stl_path, output_png, role, mesh_hex):
        return PreviewRenderResult(ok=True, points=0, error="")

    try:
        import pyvista as pv  # noqa: F401
    except ImportError:
        return PreviewRenderResult(ok=False, error="pyvista not installed")

    try:
        return _preview_pyvista(stl_path, output_png, role, mesh_hex)
    except Exception as exc:
        return PreviewRenderResult(ok=False, error=f"{type(exc).__name__}: {exc}")
