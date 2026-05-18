"""Offscreen STL preview rendering (no Qt VTK widget — avoids macOS crashes)."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from print_partner.core.mesh_color import resolve_mesh_color
from print_partner.core.vtk_lock import vtk_lock

_PREVIEW_POINT_LIMIT = 80_000
_PREVIEW_SIZE = (640, 480)


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


def render_stl_preview_png(
    stl_path: Path,
    output_png: Path,
    role: str = "primary",
    mesh_hex: str | None = None,
) -> PreviewRenderResult:
    """Render STL to PNG using PyVista offscreen only."""
    if not stl_path.is_file():
        return PreviewRenderResult(ok=False, error="file not found")
    try:
        import pyvista as pv
    except ImportError:
        return PreviewRenderResult(ok=False, error="pyvista not installed")

    try:
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
            plotter.add_mesh(mesh, color=color, show_edges=True, edge_color="#666666")
            plotter.view_isometric()
            plotter.camera.zoom(1.1)
            plotter.screenshot(str(output_png))
            plotter.close()
        if not output_png.is_file():
            return PreviewRenderResult(ok=False, points=points_before, error="screenshot failed")
        return PreviewRenderResult(ok=True, points=int(mesh.n_points), error="")
    except Exception as exc:
        return PreviewRenderResult(ok=False, error=f"{type(exc).__name__}: {exc}")
