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

Optional STL thumbnails:

```bash
# install stl-thumb if available on your system
```

## Run

```bash
print-partner
# or
python -m print_partner
```

## Usage

1. **Projects** — Add GitHub repos (name, URL, branch). **Sync selected** or **Sync all** to clone/pull into `~/.print-partner/repos/{name}` (progress dialog, cancellable).
2. Import bulk projects via **Import repos.txt** (`name,url,branch` per line).
3. **Profiles** — Use **New build…** for the guided wizard (recommended):
   - Name the build or **Load saved build** to edit an existing profile
   - Add the **base** repo (Git: pick existing or enter URL + branch; **Local folder**: browse to STLs)
   - Curate which base parts to print (include/exclude, multiselect)
   - Optionally add **addon** repos with the same source + curation steps
   - **Finish** saves the profile, merges parts, and starts background thumbnails
   - **Duplicate build** clones the current profile into a new wizard run
   - Power users can still use **New** / **Set base** / **Add addon** / **Recompute** manually
   - The app **remembers your last profile and tab** when you reopen it
4. After **Recompute**, thumbnails for included parts are **cached in the background** (status line under the toolbar). Large builds stay responsive.
5. Filter by status/role/filament, toggle include, edit overrides. Select a part for **3D preview** (subprocess offscreen render; stable on macOS).
6. **Export HTML** copies cached thumbnails into `~/.print-partner/exports/` when possible (fast). Missing thumbs are generated on demand via isolated subprocesses.
7. **Open HTML** opens the current profile’s export (or pick any file from the exports folder).

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

## Packaging

```bash
pip install pyinstaller
pyinstaller packaging/print_partner.spec
```

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

## Known limitations (MVP)

- Manual layers are stored but not fully scanned from arbitrary folders
- Geometry compare is vertex-count / coarse equality only
- **3D preview** renders offscreen to an image in the panel (no embedded VTK window; avoids macOS crashes). **HTML thumbnails** use `stl-thumb` when on PATH, else PyVista offscreen
- Optional: install [stl-thumb](https://github.com/coin-operated-video/stl-thumb) for faster export thumbnails matching Voron manifest colors
- Git sync uses shallow clone; large repos may need manual depth adjustment
- No cloud sync or multi-user support
