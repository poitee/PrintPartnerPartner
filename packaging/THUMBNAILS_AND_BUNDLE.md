# Thumbnails and bundle size (VTK / PyVista evaluation)

## Current default (recommended for v1)

Keep **PyVista + VTK** in the PyInstaller bundle:

- Filament-colored thumbs and previews match the picker
- Works without partners installing `stl-thumb`
- Already batched in subprocesses (no embedded VTK window)

**Cost:** ~200–400 MB installer; longer cold start for thumb batches.

## Optional: `stl-thumb` on partner machines

Partners can install `stl-thumb` for faster role-only renders. The app prefers it when on PATH; PyVista remains the fallback for colored meshes.

## Future slim bundle (not implemented)

Dropping PyVista/VTK from `pyproject.toml` and the spec would shrink the bundle substantially but:

- Loses accurate filament-colored previews unless Three.js or another renderer is added
- Requires `stl-thumb` (or similar) on every machine for acceptable thumbs
- Needs regression tests on export HTML thumb quality

**Decision for v1:** ship full bundle; document optional `stl-thumb` in README and first-run dialog.

## Regenerating thumbs after render changes

Bump `THUMB_CACHE_VERSION` in `print_partner/core/thumbnails.py` and ask users to delete `~/.print-partner/thumbs/` or run **Recompute**.
