# Print Partner

Local-first Python desktop app for composing layered 3D print manifests from GitHub STL repositories.

## Features

- Sync GitHub STL repos (GitPython) into `~/.print-partner/repos`
- Auto-classify parts by role (`[a]` accent, `[c]` clear, `[o]` opaque) and quantity (`_xN` suffix)
- Layered build profiles: base + addon repos with merge engine
- PySide6 UI: project library, profile composer, diff filters, STL preview (PyVista)
- HTML export (Jinja2), optional `stl-thumb` thumbnails
- SQLite persistence in `~/.print-partner`

## Requirements

- Python 3.11+ (3.9+ may work with `Optional` types in models; 3.11 recommended)
- macOS / Linux / Windows

## Install

```bash
cd PrintPartnerPartner
python -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -e ".[dev]"
```

Optional STL thumbnails (faster than built-in PyVista when installed):

```bash
cargo install stl-thumb
# or see https://github.com/unlimitedbacon/stl-thumb
```

## Run

```bash
print-partner
# or
python -m print_partner
```

## Usage

Workflow tabs: **Source → Build → Verify → Checkoff**. The app remembers your last tab and profile.

1. **Source** — Add GitHub repos (name, URL, branch). **Sync selected** or **Sync all** to clone/pull into `~/.print-partner/repos/{name}` (progress dialog, cancellable).
   - After sync (or when adding a local folder), use **Import files…** to choose which STL files and folders to include. Only selected paths are scanned into profiles (large repos stay fast). The **STLs imported** column shows how many files match your selection.
   - Select a project to browse its folder tree and read README / markdown docs for the repo root or selected folder.
2. Import bulk projects via **Import repos.txt** (`name,url,branch` per line), then **Sync all** and configure **Import files…** per repo.
3. **Build** — Compose kits: layers, **Recompute**, part filters, filament overrides, STL preview, and docs for the selected part’s folder. Parts are shown in a **collapsible repo → folder → STL tree** — check a repo or folder to include or exclude its entire subtree. Use **New build…** for the guided wizard (recommended) or **New** / **Set base** / **Add addon** manually. **Duplicate build** clones the current profile into a new wizard run.
4. **Verify** — Same collapsible **repo → folder → STL tree** as Build, but only **included** parts. Uncheck **Print** on a part (or use **Exclude selected**) to remove it from the kit before you print. The summary bar reports how many parts are chosen and flags unset filament or conflicts.
5. **Checkoff** — Scrollable checklist matching the **HTML export**: repo/folder headings, readable filenames, **Qty**, **Printed** (saved to profile), **Verified** (empty box for customer sign-off on printouts), larger **Thumb** images, and **Notes**. Filament colors are listed once at the top of the export. Select a row for **3D preview** on the right. Run **Recompute** on Build to warm thumbnails. **Export HTML** / **Open HTML** for a printable checklist.
6. After **Recompute** on Build, thumbnails for included parts are **cached in the background**. Select a part for **3D preview** (subprocess offscreen render; stable on macOS).

### repos.txt example

```text
# name,url,branch
my-kit,https://github.com/you/my-stl-kit.git,main
addons,https://github.com/you/extra-parts.git,main
```

## Tests

```bash
pytest
```

CI runs pytest on Ubuntu and macOS (Python 3.11) and `ruff check` on pull requests.

## Packaging

```bash
chmod +x packaging/build_release.sh
./packaging/build_release.sh
```

Or manually:

```bash
pip install pyinstaller
pyinstaller packaging/print_partner.spec
```

The spec builds an **onedir** bundle (`dist/Print Partner/` on Linux/Windows, `dist/Print Partner.app` on macOS). Expect roughly 200–400 MB because of PySide6 and VTK/PyVista.

## Sharing with print partners

- **Git on PATH** — Sync uses the system `git` binary (GitPython does not bundle git). Partners need git installed and available in their shell.
- **Data directory** — Back up `~/.print-partner/` before moving machines: `print_partner.db`, `repos/`, and optionally `thumbs/` and `exports/`.
- **Frozen build** — Ship the onedir folder or `.app` from `packaging/build_release.sh` after tests pass; partners run the executable without installing Python.
- **Optional `stl-thumb`** — Recommend `cargo install stl-thumb` on shop-floor machines for faster role-only thumbnails (see Thumbnail generation below).

## Data directory

| Path | Purpose |
|------|---------|
| `~/.print-partner/print_partner.db` | SQLite database |
| `~/.print-partner/repos/` | Cloned repositories |
| `~/.print-partner/exports/` | HTML exports |
| `~/.print-partner/exports/thumbs/` | Per-export PNG copies for portable HTML |
| `~/.print-partner/thumbs/` | Global thumbnail cache (warmed after Recompute) |

## Part naming conventions

| Marker | Role |
|--------|------|
| `[a]` in path/filename | accent |
| `[c]` | clear |
| `[o]` | opaque |
| (none) | primary |
| `_x4` or ` x4` before `.stl` | quantity 4 |

## Thumbnail generation

Thumbnails are **384×384 PNG** files cached under `~/.print-partner/thumbs/`. After **Recompute**, the app warms the cache in the background; **Export HTML** copies those PNGs into the export folder.

### Backends (automatic)

| Order | Backend | When used |
|-------|---------|-----------|
| 1 | **stl-thumb** | On your `PATH`; preferred for speed when no custom filament color |
| 2 | **PyVista** (built-in) | Always available if `pyvista` is installed; used for filament-colored parts and as fallback |

With a **filament color** assigned, PyVista is tried first so the mesh matches the picker; then `stl-thumb` with `-m` material colors.

### stl-thumb options (used by Print Partner)

Print Partner invokes `stl-thumb` roughly as:

```text
stl-thumb -s 384 -b ffffffff -a fxaa -m <ambient> <diffuse> <specular> model.stl out.png
```

| Flag | Meaning |
|------|---------|
| `-s` / `--size` | Square image size in pixels (default in app: **384**) |
| `-b` / `--background` | Background RGBA hex (`ffffffff` = white) |
| `-a` / `--antialiasing` | `fxaa` (default) or `none` |
| `-m` / `--material` | Phong colors: ambient, diffuse, specular (hex, no `#`) — diffuse is the visible body color |
| `-f` / `--format` | Output format if extension omitted (PNG, JPEG, …) |
| `--recalc-normals` | Fix broken STL normals (not passed by default) |

Role-only thumbs (no filament) use lighter default colors per part role (`primary`, `accent`, `clear`, `opaque`). Very dark filament colors are automatically lifted for thumbnails only (`boost_dark_hex_for_thumbnail` in `mesh_color.py`); the filament picker still shows the true color.

### PyVista options (in code)

Tunable constants in `print_partner/core/thumbnails.py` and `stl_camera.py`:

| Setting | Default | Purpose |
|---------|---------|---------|
| `THUMB_PNG_SIZE` | 384 | Render resolution |
| `THUMB_CAMERA_PADDING` | 0.88 | Zoom out so the full part fits (avoids clipped edges) |
| `THUMB_MESH_POINT_LIMIT` | 80,000 | Decimate huge meshes before render |
| `THUMB_SHOW_EDGES` | true | Edge lines on the mesh (improves dark-part readability) |
| `THUMB_CACHE_VERSION` | v2 | Cache key suffix; bump to regenerate all thumbs after render changes |
| `PREVIEW_SHOW_EDGES` | true | Same as thumbs — light edge outline on 3D preview |
| `PREVIEW_PNG_SIZE` | 640 | stl-thumb square size when used for preview |

3D **preview** in the app uses a larger window (640×480) and `PREVIEW_CAMERA_PADDING` 0.90. When `stl-thumb` is on your `PATH`, preview uses it first (solid mesh, no edge lines); otherwise PyVista offscreen with edges disabled.

After changing filament colors, use **Recompute** or re-export so thumbnails regenerate (old cache entries are invalidated).

### Performance notes

- **Batch thumbnails** — Background caching runs up to 32 STLs per subprocess so PyVista/VTK loads once per batch instead of per file (large speedup on big builds).
- **stl-thumb** — When installed, used first for role-only colors; `-a none` is the default for faster renders (see `STL_THUMB_ANTIALIAS` in `thumbnails.py`).
- **Profile UI** — Loading a profile batches filament catalog and print-progress lookups; typing in the parts filter waits 200ms before rebuilding the parts tree.
- **Export HTML** — Reuses cached PNGs from `~/.print-partner/thumbs/` when fresh; only missing thumbs are generated during export.

## Known limitations (MVP)

- Manual layers are stored but not fully scanned from arbitrary folders
- Geometry compare is vertex-count / coarse equality only
- **3D preview** renders offscreen to an image in the panel (no embedded VTK window; avoids macOS crashes)
- Git sync uses shallow clone; large repos may need manual depth adjustment
- No cloud sync or multi-user support
