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

Workflow: **Libraries → Kit → Print → Checkoff** (top navigation strip, **Ctrl+1–4**). On **Kit**, choose **Compose** or **Review** under step 2 when a kit is open. Press **F1** for the full guide.

1. **Libraries** (Ctrl+1) — Add/sync GitHub repos or local folders. **Import files…** chooses which STL paths are scanned into kits. Browse the repo tree and read README/docs.
2. Import bulk repos via **Import repos.txt** (`name,url,branch` per line), then **Sync all** and **Import files…** per repo.
3. **Kit** (Ctrl+2) — **Your kits**: open, rename, duplicate, delete. **Compose** — layers, **Recompute**, filament, parts tree, preview, docs, AI. **Review** — included parts only before checkoff.
4. **Print** (Ctrl+3) — Enable printers, load filament spools, preview assignment, **Export 3MF…** (primary slicer export).
5. **Checkoff** (Ctrl+4) — Printable checklist (Qty, Printed, Verified, thumbs, Notes), **Export checklist** HTML. Use **Print** for 3MF plates.
6. Thumbnails cache in the background after **Recompute**; 3D preview uses offscreen render (stable on macOS).

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

CI runs `ruff check src tests` and pytest on Ubuntu and macOS (Python 3.11 and 3.12), plus Windows (Python 3.11, Qt UI tests excluded). See [`.github/workflows/ci.yml`](.github/workflows/ci.yml).

## Packaging

```bash
chmod +x packaging/build_release.sh packaging/package_artifacts.sh
./packaging/build_release.sh
```

This runs pytest, PyInstaller, then writes versioned archives under `dist/artifacts/` (`.zip` on macOS/Windows, `.tar.gz` on Linux). On macOS, a `.dmg` is also created when `hdiutil` is available.

Or manually:

```bash
pip install pyinstaller
pyinstaller packaging/print_partner.spec --noconfirm
./packaging/package_artifacts.sh
```

The spec builds an **onedir** bundle (`dist/Print Partner/` on Linux/Windows, `dist/Print Partner.app` on macOS). Expect roughly 200–400 MB because of PySide6 and VTK/PyVista. **macOS DMGs target macOS 12+** (NumPy 1.26.x; avoid NumPy 2 wheels that require macOS 14). See [`packaging/README_RELEASE.md`](packaging/README_RELEASE.md) and [`packaging/THUMBNAILS_AND_BUNDLE.md`](packaging/THUMBNAILS_AND_BUNDLE.md).

### GitHub Releases

1. Bump version in `pyproject.toml`, `__version__`, and `CHANGELOG.md`.
2. **Actions → Build all platforms** — confirms Linux, macOS, and Windows builds on `main` (also runs on every push to `main`).
3. Publish via **tag** (`git push origin v0.2.3`) or **Actions → Release (create tag)** with version `0.2.3`.

See [`packaging/README_RELEASE.md`](packaging/README_RELEASE.md) for details. 3MF slicer checks: [`docs/3MF_EXPORT_VALIDATION.md`](docs/3MF_EXPORT_VALIDATION.md).

### Smoke test before shipping

Use the checklist in [`docs/RELEASE_SMOKE_TEST.md`](docs/RELEASE_SMOKE_TEST.md).

## Sharing kits with print partners

Export a portable kit file (`.print-partner-kit.zip`) from **Your kits** or **Kit → Manage → Export kit for sharing…**. The bundle includes:

- Kit name and order number
- Layer setup (which repos are base/addons), matched by **repo name or URL** on import
- All parts with filament colors, quantities, inclusion, and notes

**Import** via **Import kit…** on the kit list or **Manage → Import shared kit…**. If a referenced repository is not on the recipient’s machine yet, add and sync it on **Libraries**, then adjust layers or run **Recompute**.

Print progress is not included in exports (recipients start a fresh checkoff). For shop-floor HTML/STL output, use **Export checklist** / **Export STLs** as before.

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
| `THUMB_SHOW_EDGES` | false | Solid mesh; boundary outline only (no triangle wireframe) |
| `THUMB_CACHE_VERSION` | v3 | Cache key suffix; bump to regenerate all thumbs after render changes |
| `PREVIEW_SHOW_EDGES` | false | Solid mesh in offscreen preview when using PyVista |
| `PREVIEW_PNG_SIZE` | 640 | stl-thumb square size when used for preview |

3D **preview** in the app uses a larger window (640×480) and `PREVIEW_CAMERA_PADDING` 0.90. When `stl-thumb` is on your `PATH`, preview uses it first (solid mesh, no edge lines); otherwise PyVista offscreen with edges disabled.

After changing filament colors, use **Recompute** or re-export so thumbnails regenerate (old cache entries are invalidated).

### Performance notes

- **Batch thumbnails** — Background caching runs up to 32 STLs per subprocess so PyVista/VTK loads once per batch instead of per file (large speedup on big builds).
- **stl-thumb** — When installed, used first for role-only colors; `-a none` is the default for faster renders (see `STL_THUMB_ANTIALIAS` in `thumbnails.py`).
- **Profile UI** — Loading a profile batches filament catalog and print-progress lookups; typing in the parts filter waits 200ms before rebuilding the parts tree.
- **Export HTML** — Reuses cached PNGs from `~/.print-partner/thumbs/` when fresh; only missing thumbs are generated during export.

## AI assistant (optional)

On **Kit**, open the **Assistant** tab (Preview / Docs / Assistant). The AI receives app workflow context, repositories, filament catalog ids, and the active kit. It is **disabled by default**.

1. **Help → AI settings…** — enable the assistant, choose provider (OpenAI, Anthropic, or OpenAI-compatible), model, and API key.
2. API key stored only in `~/.print-partner/ai_secrets.json` (gitignored).
3. **Ask** sends context plus your question; **Review suggestions…** lets you pick which changes to apply (include/exclude, filament, role, qty, notes, navigation).

**Offline:** the **Suggestions** panel above the parts tree uses README/fuzzy heuristics without an API key.

## Known limitations (MVP)

- Manual layers are stored but not fully scanned from arbitrary folders
- Geometry compare is vertex-count / coarse equality only
- **3D preview** renders offscreen to an image in the panel (no embedded VTK window; avoids macOS crashes)
- Git sync uses shallow clone; large repos may need manual depth adjustment
- No cloud sync or multi-user support
