"""STL thumbnail generation for HTML export and UI."""

from __future__ import annotations

import hashlib
import json
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Callable, Optional

from print_partner.config import settings
from print_partner.core.parsers import PartRole
from print_partner.core.stl_camera import THUMB_CAMERA_PADDING, THUMB_PNG_SIZE, fit_mesh_in_view
from print_partner.core.vtk_lock import vtk_lock

# Tunables (also documented in README — Thumbnail generation).
THUMB_MESH_POINT_LIMIT = 80_000
THUMB_SHOW_EDGES = True
THUMB_EDGE_COLOR = "#888888"
THUMB_BACKGROUND = "white"
# Bump when thumb rendering policy changes so old PNGs are regenerated.
THUMB_CACHE_VERSION = "v2"
# stl-thumb: https://github.com/unlimitedbacon/stl-thumb
STL_THUMB_BACKGROUND_RGBA = "ffffffff"  # opaque white
STL_THUMB_ANTIALIAS = "none"  # faster than fxaa; set to "fxaa" for smoother edges
THUMB_BATCH_SIZE = 32  # thumbnails per child process (one VTK import)

# Role default mesh colors (preview / picker); thumbnails also apply boost_dark_hex_for_thumbnail.
ROLE_MESH_RGB: dict[str, str] = {
    PartRole.ACCENT.value: "#880000",
    PartRole.CLEAR.value: "#606060",
    PartRole.OPAQUE.value: "#484848",
    PartRole.PRIMARY.value: "#606060",
}

STL_THUMB_ARGS: dict[str, list[str]] = {
    PartRole.ACCENT.value: ["-m", "550000", "990000", "ffffff"],
    PartRole.CLEAR.value: ["-m", "606060", "404040", "aaaaaa"],
    PartRole.OPAQUE.value: ["-m", "303030", "606060", "ffffff"],
    PartRole.PRIMARY.value: ["-m", "404040", "707070", "cccccc"],
}


def thumbnail_cache_digest(stl_path: Path, role: str, mesh_hex: str | None = None) -> str:
    """Stable cache filename stem from STL path, mtime, role, and filament color."""
    from print_partner.core.mesh_color import normalize_mesh_hex

    try:
        mtime = stl_path.stat().st_mtime
    except OSError:
        mtime = 0
    color_key = normalize_mesh_hex(mesh_hex) or ""
    payload = f"{stl_path.resolve()}|{mtime}|{role}|{color_key}|{THUMB_CACHE_VERSION}"
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


def stl_thumb_command(
    stl_path: Path,
    out_path: Path,
    role: str,
    mesh_hex: str | None = None,
    *,
    size: int | None = None,
) -> list[str]:
    """Build stl-thumb argv: size, background, material colors, antialiasing."""
    if mesh_hex:
        from print_partner.core.mesh_color import mesh_color_for_stl_thumb

        material = mesh_color_for_stl_thumb(mesh_hex)
    else:
        material = STL_THUMB_ARGS.get(role, STL_THUMB_ARGS[PartRole.PRIMARY.value])
    return [
        "stl-thumb",
        "-s",
        str(size if size is not None else THUMB_PNG_SIZE),
        "-b",
        STL_THUMB_BACKGROUND_RGBA,
        "-a",
        STL_THUMB_ANTIALIAS,
        *material,
        str(stl_path),
        str(out_path),
    ]


def _thumbnail_stl_thumb(stl_path: Path, out_path: Path, role: str, mesh_hex: str | None = None) -> bool:
    if not shutil.which("stl-thumb"):
        return False
    try:
        result = subprocess.run(
            stl_thumb_command(stl_path, out_path, role, mesh_hex),
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
            from print_partner.core.mesh_color import resolve_thumbnail_mesh_color
            from print_partner.core.stl_preview_render import _load_mesh, _simplify_mesh

            color = resolve_thumbnail_mesh_color(role, mesh_hex)
            mesh = _load_mesh(stl_path, point_limit=THUMB_MESH_POINT_LIMIT)
            if mesh is None:
                mesh = pv.read(str(stl_path))
            mesh = _simplify_mesh(mesh, limit=THUMB_MESH_POINT_LIMIT)
            size = THUMB_PNG_SIZE
            plotter = pv.Plotter(off_screen=True, window_size=(size, size))
            plotter.set_background(THUMB_BACKGROUND)
            plotter.add_mesh(
                mesh,
                color=color,
                show_edges=THUMB_SHOW_EDGES,
                edge_color=THUMB_EDGE_COLOR,
            )
            fit_mesh_in_view(plotter, padding=THUMB_CAMERA_PADDING)
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
    results = generate_thumbnails_batch_subprocess([(stl_path, out_path, role, mesh_hex)])
    return results.get(out_path, False)


def generate_thumbnails_batch_subprocess(
    jobs: list[tuple[Path, Path, str, str | None]],
) -> dict[Path, bool]:
    """
    Generate many thumbnails in one subprocess (loads PyVista once).
    Returns map of output_path -> success.
    """
    from print_partner.core.mesh_color import normalize_mesh_hex

    if not jobs:
        return {}
    payload = []
    out_paths: list[Path] = []
    for stl_path, out_path, role, mesh_hex in jobs:
        out_paths.append(out_path)
        entry: dict = {
            "stl": str(stl_path.resolve()),
            "out": str(out_path.resolve()),
            "role": role,
        }
        normalized = normalize_mesh_hex(mesh_hex)
        if normalized:
            entry["hex"] = normalized
        payload.append(entry)

    jobs_file: Path | None = None
    try:
        with tempfile.NamedTemporaryFile(
            mode="w",
            suffix=".json",
            delete=False,
            encoding="utf-8",
        ) as handle:
            json.dump(payload, handle)
            jobs_file = Path(handle.name)
        timeout = max(120, 45 * len(jobs))
        result = subprocess.run(
            [sys.executable, "-m", "print_partner.thumb_batch_cli", str(jobs_file)],
            capture_output=True,
            timeout=timeout,
            check=False,
        )
    except (OSError, subprocess.SubprocessError):
        return {out: False for out in out_paths}
    finally:
        if jobs_file is not None:
            jobs_file.unlink(missing_ok=True)

    success = {out: out.is_file() for out in out_paths}
    if result.returncode != 0:
        for out in out_paths:
            success[out] = out.is_file()
    return success


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
