"""STL thumbnail generation for HTML export and UI."""

from __future__ import annotations

import hashlib
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Callable, Optional

from print_partner.config import settings
from print_partner.core.parsers import PartRole
from print_partner.core.vtk_lock import vtk_lock

# Mesh colors aligned with stl-manifest-generator gen-thumbs.sh
ROLE_MESH_RGB: dict[str, str] = {
    PartRole.ACCENT.value: "#770000",
    PartRole.CLEAR.value: "#505050",
    PartRole.OPAQUE.value: "#101010",
    PartRole.PRIMARY.value: "#303030",
}

STL_THUMB_ARGS: dict[str, list[str]] = {
    PartRole.ACCENT.value: ["-m", "770000", "111111", "ffffff"],
    PartRole.CLEAR.value: ["-m", "505050", "222222", "888888"],
    PartRole.OPAQUE.value: ["-m", "000000", "050505", "ffffff"],
    PartRole.PRIMARY.value: ["-m", "222222", "050505", "777777"],
}


def thumbnail_cache_digest(stl_path: Path, role: str, mesh_hex: str | None = None) -> str:
    """Stable cache filename stem from STL path, mtime, role, and filament color."""
    from print_partner.core.mesh_color import normalize_mesh_hex

    try:
        mtime = stl_path.stat().st_mtime
    except OSError:
        mtime = 0
    color_key = normalize_mesh_hex(mesh_hex) or ""
    payload = f"{stl_path.resolve()}|{mtime}|{role}|{color_key}"
    return hashlib.sha256(payload.encode()).hexdigest()[:16]


def global_thumbnail_path(stl_path: Path, role: str, mesh_hex: str | None = None) -> Path:
    settings.ensure_dirs()
    return settings.thumbs_dir / f"{thumbnail_cache_digest(stl_path, role, mesh_hex)}.png"


def thumbnail_cache_path(stl_path: Path, export_dir: Path, role: str = "primary", mesh_hex: str | None = None) -> Path:
    """Export-local path (same digest as global cache)."""
    return export_dir / "thumbs" / f"{thumbnail_cache_digest(stl_path, role, mesh_hex)}.png"


def invalidate_global_thumbnails(
    stl_path: Path,
    role: str,
    mesh_hex: str | None = None,
    *,
    all_variants: bool = False,
) -> None:
    """Delete cached PNG(s) so the next ensure/generate pass picks up new filament color."""
    if not stl_path.is_file():
        return
    hexes: list[str | None]
    if all_variants:
        hexes = [None, mesh_hex]
        if mesh_hex:
            bare = mesh_hex.lstrip("#")
            hexes.extend([bare, f"#{bare}"])
    else:
        hexes = [mesh_hex]
    seen: set[str | None] = set()
    for mh in hexes:
        if mh in seen:
            continue
        seen.add(mh)
        path = global_thumbnail_path(stl_path, role, mh)
        try:
            path.unlink(missing_ok=True)
        except OSError:
            pass


def is_thumbnail_fresh(stl_path: Path, png_path: Path) -> bool:
    if not png_path.is_file():
        return False
    try:
        return stl_path.stat().st_mtime <= png_path.stat().st_mtime
    except OSError:
        return False


def _thumbnail_stl_thumb(stl_path: Path, out_path: Path, role: str, mesh_hex: str | None = None) -> bool:
    if not shutil.which("stl-thumb"):
        return False
    if mesh_hex:
        from print_partner.core.mesh_color import mesh_color_for_stl_thumb

        extra = mesh_color_for_stl_thumb(mesh_hex)
    else:
        extra = STL_THUMB_ARGS.get(role, STL_THUMB_ARGS[PartRole.PRIMARY.value])
    try:
        result = subprocess.run(
            ["stl-thumb", *extra, str(stl_path), str(out_path)],
            check=False,
            capture_output=True,
            timeout=60,
        )
        return result.returncode == 0 and out_path.is_file()
    except (OSError, subprocess.SubprocessError):
        return False


def _thumbnail_pyvista(stl_path: Path, out_path: Path, role: str, mesh_hex: str | None = None) -> bool:
    try:
        import pyvista as pv
    except ImportError:
        return False
    try:
        with vtk_lock():
            from print_partner.core.mesh_color import resolve_mesh_color
            from print_partner.core.stl_preview_render import _load_mesh, _simplify_mesh

            color = resolve_mesh_color(role, mesh_hex)
            mesh = _load_mesh(stl_path, point_limit=80_000)
            if mesh is None:
                mesh = pv.read(str(stl_path))
            mesh = _simplify_mesh(mesh, limit=80_000)
            plotter = pv.Plotter(off_screen=True, window_size=(256, 256))
            plotter.set_background("white")
            plotter.add_mesh(mesh, color=color, show_edges=True, edge_color="#666666")
            plotter.view_isometric()
            plotter.camera.zoom(1.15)
            out_path.parent.mkdir(parents=True, exist_ok=True)
            plotter.screenshot(str(out_path))
            plotter.close()
        return out_path.is_file()
    except Exception:
        return False


def generate_thumbnail(
    stl_path: Path,
    out_path: Path,
    role: str = "primary",
    mesh_hex: str | None = None,
) -> bool:
    """Create PNG thumbnail; PyVista for filament colors, else stl-thumb then PyVista."""
    from print_partner.core.mesh_color import normalize_mesh_hex

    if not stl_path.is_file():
        return False
    out_path.parent.mkdir(parents=True, exist_ok=True)
    filament_hex = normalize_mesh_hex(mesh_hex)
    if filament_hex:
        if _thumbnail_pyvista(stl_path, out_path, role, filament_hex):
            return True
        if _thumbnail_stl_thumb(stl_path, out_path, role, filament_hex):
            return True
        return False
    if _thumbnail_stl_thumb(stl_path, out_path, role, None):
        return True
    return _thumbnail_pyvista(stl_path, out_path, role, None)


def generate_thumbnail_subprocess(
    stl_path: Path,
    out_path: Path,
    role: str,
    mesh_hex: str | None,
) -> bool:
    """Run generate_thumbnail in a child process so VTK never loads in the Qt app."""
    from print_partner.core.mesh_color import normalize_mesh_hex

    cmd = [
        sys.executable,
        "-m",
        "print_partner.thumb_cli",
        str(stl_path.resolve()),
        str(out_path.resolve()),
        role,
    ]
    normalized = normalize_mesh_hex(mesh_hex)
    if normalized:
        cmd.append(normalized)
    try:
        result = subprocess.run(cmd, capture_output=True, timeout=180, check=False)
        return result.returncode == 0 and out_path.is_file()
    except (OSError, subprocess.SubprocessError):
        return False


# Backward-compatible alias
_generate_thumbnail_subprocess = generate_thumbnail_subprocess


def ensure_global_thumbnail(
    stl_path: Path,
    role: str = "primary",
    mesh_hex: str | None = None,
    *,
    force: bool = False,
    isolate_vtk: bool = True,
) -> Path | None:
    """Ensure PNG exists in global cache; return path or None."""
    if not stl_path.is_file():
        return None
    from print_partner.core.mesh_color import normalize_mesh_hex

    mesh_hex = normalize_mesh_hex(mesh_hex)
    out = global_thumbnail_path(stl_path, role, mesh_hex)
    if not force and is_thumbnail_fresh(stl_path, out):
        return out
    if isolate_vtk:
        ok = generate_thumbnail_subprocess(stl_path, out, role, mesh_hex)
    else:
        ok = generate_thumbnail(stl_path, out, role, mesh_hex)
    return out if ok else None


def copy_thumbnail_for_export(global_png: Path, export_dir: Path) -> str | None:
    """Copy cached PNG into export folder; return relative img src."""
    if not global_png.is_file():
        return None
    dest_dir = export_dir / "thumbs"
    dest_dir.mkdir(parents=True, exist_ok=True)
    dest = dest_dir / global_png.name
    if not dest.is_file() or global_png.stat().st_mtime > dest.stat().st_mtime:
        shutil.copy2(global_png, dest)
    return f"thumbs/{dest.name}"


def ensure_thumbnail(
    stl_path: Path | None,
    export_dir: Path,
    role: str = "primary",
    *,
    mesh_hex: str | None = None,
    force: bool = False,
    isolate_vtk: bool = True,
) -> str | None:
    """
    Return relative path (from export_dir) for HTML img src.
    Uses global cache; copies into export_dir/thumbs/ for portable HTML.
    """
    if stl_path is None or not stl_path.is_file():
        return None
    export_dir.mkdir(parents=True, exist_ok=True)
    cached = ensure_global_thumbnail(
        stl_path, role, mesh_hex, force=force, isolate_vtk=isolate_vtk
    )
    if cached is None:
        return None
    return copy_thumbnail_for_export(cached, export_dir)


ProgressCallback = Callable[[int, int, str], None]


def generate_export_thumbnails(
    items: list[tuple[Path | None, str, str | None]],
    export_dir: Path,
    on_progress: Optional[ProgressCallback] = None,
) -> list[str | None]:
    """Generate thumbnails for export rows; items are (stl_path, role, mesh_hex)."""
    total = len(items)
    results: list[str | None] = []
    for i, (stl_path, role, mesh_hex) in enumerate(items):
        if on_progress:
            name = stl_path.name if stl_path else ""
            on_progress(i + 1, total, name)
        results.append(ensure_thumbnail(stl_path, export_dir, role, mesh_hex=mesh_hex))
    return results
