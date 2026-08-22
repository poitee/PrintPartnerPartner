# Screenshots

Workflow screenshots of the Print Partner web app, used by the root [README](../../README.md) and the GitHub Pages landing page ([`../index.html`](../index.html)). Captured from the running app at **1440×900**.

## Layout

```text
docs/screenshots/
  light/   sources.png builds.png build.png review.png progress.png export.png
  dark/    (same filenames)
  README.md
```

Filenames are stable for README / GitHub Pages embeds. Spine labels and routes:

- **Library** `/library`
- **Builds** `/builds`
- **Sources** `/sources`
- **Plan** `/plan`
- **Checkoff** `/progress`
- **Production** `/export?profile=` (Build) and `/production` (global)

Optional Progress/Export PNGs (`progress.png`, `export.png`) are captured by the current script. Older `advisor.png` / `settings-ai.png` files (if present) are leftovers from the removed in-app Kit Advisor — do not re-link them from README or Pages.

The root README embeds **light** PNGs. GitHub Pages uses theme pairs for light/dark.

| File | Spine label | Route / UI | Shows |
|------|-------------|------------|-------|
| `sources.png` | Library | `/library` | Source library: categories, sync, update badges, STL search |
| `builds.png` | Builds | `/builds` | Builds list: create, rename, duplicate, archive, restore |
| `build.png` | Sources | `/sources` | Attach sources and picks for a Build |
| `review.png` | Plan | `/plan` | Quantities, warnings, Apply |
| `progress.png` | Checkoff | `/progress` | Print checkoff |
| `export.png` | Production | `/export` | Plates, downloads, slicer handoff |

## Prerequisites (representative data)

1. Start the app (`docker compose up --build` or local single-port run on `:8080`).
2. Add and sync at least one source with STLs.
3. Create a plan, attach the source, rebuild a draft, pick STL files and quantities, then apply the draft so accepted parts exist.

Optional: pass `--profile-id N` to select a specific plan when multiple exist.

## Automated capture (Playwright)

1. Install capture dependencies once:

```bash
cd docs/scripts && npm install && npx playwright install chromium
```

2. Capture both themes:

```bash
cd docs/scripts
node capture-screenshots.mjs --theme light
node capture-screenshots.mjs --theme dark
```

Optional flags:

- `--url http://localhost:8080` — app base URL (default)
- `--out ../screenshots/light` — output directory (defaults to `docs/screenshots/{theme}/`)
- `--profile-id 1` — append `?profile=1` on first load

**Important:** Do not paste `/library` (or `/plan`, `/parts`, `/progress`, `/plans`, `/settings`) into the address bar on a cold load in Docker single-port mode — some paths are also API routes. Client-side navigation from `/` avoids that.

Three.js renders STL previews client-side; allow a moment for previews to load before capturing Parts.
