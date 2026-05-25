# Print Partner

**Print Partner** is a desktop app for anyone who prints from layered STL kits — base repo plus add-ons, accent/clear parts, quantities in filenames, and a pile of folders to keep straight. It lives on your machine, syncs GitHub (or local) repos, and walks you from “what’s in this build?” to “what’s on the plate?” to “what did we already run?”

No cloud account. Your data stays in `~/.print-partner`.

---

## Why it exists

If you’ve ever:

- merged a **base kit** with **addon repos** and lost track of what changed,
- assigned **filament colors** across dozens of parts,
- wanted a **shop-floor checklist** that actually remembers what you printed,
- or exported **3MF plates** grouped by printer, filament, and folder —

…this is the workflow the app is built around.

---

## Quick start

**Requirements:** Python 3.11+ · macOS, Linux, or Windows · `git` on your PATH for repo sync

```bash
git clone https://github.com/poitee/PrintPartnerPartner.git
cd PrintPartnerPartner
python -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -e ".[dev]"
print-partner
```

**Pre-built installers:** [Releases](https://github.com/poitee/PrintPartnerPartner/releases) (macOS, Windows, Linux).

Optional faster thumbnails: `cargo install stl-thumb` ([upstream](https://github.com/unlimitedbacon/stl-thumb)). The app falls back to built-in PyVista rendering if it’s not installed.

---

## The workflow (Libraries → Kit → Print → Checkoff)

Use the top strip or **Ctrl+1–4**. Press **F1** anytime for the in-app guide.

| Step | What you’re doing |
|------|-------------------|
| **Libraries** | Add GitHub repos or local folders, sync STLs, import only the paths you care about. Export/import your repo list as JSON for another machine. |
| **Kit → Compose** | Stack layers (base + addons), **Recompute** the merge, curate the parts tree, assign filaments (catalog + custom colors), preview STLs, read repo docs. |
| **Kit → Review** | Sanity-check **included** parts before you commit to printing. |
| **Print** | Turn on printers, set what’s loaded on each spool, assign parts or whole **repo/folder** rows, export **3MF** (plates named `filament · repo · folder`). |
| **Checkoff** | Mark units printed (saved per kit), filter what’s left, **Print missing →** or **Export missing 3MF…**, or **Export checklist** HTML for the bench. |

**Custom filaments** — name your own colors; they travel with kit bundles and your filament library export.

**Sharing a kit** — `.print-partner-kit.zip` from **Your kits** (layers, parts, filaments, notes — not print progress). Recipient adds the same repos on Libraries, imports the kit, runs **Recompute**.

**Bulk repos** — `Import repos.txt` with `name,url,branch` per line:

```text
my-kit,https://github.com/you/my-stl-kit.git,main
addons,https://github.com/you/extra-parts.git,main
```

---

## Part naming (how the scanner thinks)

| In path / filename | Meaning |
|--------------------|---------|
| `[a]` | accent |
| `[c]` | clear |
| `[o]` | opaque |
| *(none)* | primary |
| `_x4` or ` x4` before `.stl` | quantity 4 |

---

## Where things live on disk

| Path | Purpose |
|------|---------|
| `~/.print-partner/print_partner.db` | Kits, parts, print progress |
| `~/.print-partner/repos/` | Cloned repositories |
| `~/.print-partner/thumbs/` | Thumbnail cache (after **Recompute**) |
| `~/.print-partner/exports/` | HTML checklists and related files |

Back up that folder before moving machines.

---

## Thumbnails & preview

After **Recompute**, thumbs warm in the background (384×384 PNG). **stl-thumb** is used when available; filament-colored parts use PyVista so swatches match your picker. **Export checklist** reuses the cache. Tune behavior in `print_partner/core/thumbnails.py` if you’re hacking on renders.

---

## Optional AI assistant

**Kit → Assistant** tab. Off by default. **Help → AI settings…** for provider, model, and API key (stored only in `~/.print-partner/ai_secrets.json`). Suggestions can adjust inclusion, filament, role, qty, and notes — you review before applying. Without a key, lightweight offline hints still run.

---

## Support the project

If Print Partner saves you time on the bench, [buy me a coffee on Ko-fi](https://ko-fi.com/poitee) — totally optional.

Tips are appreciation only; they **do not** grant commercial use rights.

---

## License

Print Partner uses the **[PolyForm Noncommercial License 1.0.0](LICENSE)**.

- **[LICENSE-SUMMARY.md](LICENSE-SUMMARY.md)** — what that means in plain language (use, forks, print shops, limits)
- **[COMMERCIAL.md](COMMERCIAL.md)** — when you need written permission to use or sell the **software**
- **[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)** — PySide6, VTK, and other bundled libraries

In the desktop app: **Help → License overview…** or **Help → PolyForm license (full text)…**

**Thanks to:** [stl-thumb](https://github.com/unlimitedbacon/stl-thumb), [PySide6](https://pyside.org), [lib3mf](https://github.com/3MFConsortium/lib3mf), [PyVista](https://github.com/pyvista/pyvista) / VTK.

---

## Developing & releasing

```bash
pytest
ruff check src tests
```

CI runs on Ubuntu, macOS, and Windows — see [`.github/workflows/ci.yml`](.github/workflows/ci.yml).

**Local release build:**

```bash
chmod +x packaging/build_release.sh packaging/package_artifacts.sh
./packaging/build_release.sh
```

Details: [`packaging/README_RELEASE.md`](packaging/README_RELEASE.md) · smoke test: [`docs/RELEASE_SMOKE_TEST.md`](docs/RELEASE_SMOKE_TEST.md) · 3MF checks: [`docs/3MF_EXPORT_VALIDATION.md`](docs/3MF_EXPORT_VALIDATION.md) · architecture: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

**Ship a version:** bump `pyproject.toml`, `__version__`, and `CHANGELOG.md`, green **Build all platforms** on `main`, then **Actions → Release (create tag)** with e.g. `0.3.1` (or push `v0.3.1` and run **Release** if needed).

---

## Honest MVP limits

- Layer scanning is manual-friendly, not magic for arbitrary folder trees
- Geometry diff is coarse (vertex counts, not full CAD compare)
- 3D preview is an offscreen snapshot (stable on macOS, not a live VTK window)
- Shallow git clones — huge histories may need a deeper fetch by hand
- Single user, single machine — no cloud sync

If something’s confusing on the bench, open an issue or tweak the workflow — the app is meant to stay out of your way while you print.
