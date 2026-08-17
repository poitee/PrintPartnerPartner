# Screenshots

Workflow screenshots of the Print Partner web app, used by the root [README](../../README.md) and the GitHub Pages landing page ([`../index.html`](../index.html)). Captured from the running app at **1440×900**.

## Layout

```text
docs/screenshots/
  light/   sources.png builds.png build.png review.png
  dark/    (same filenames)
  README.md
```

Filenames are stable for README / GitHub Pages embeds. Spine labels and routes:

- **Library** `/library`
- **Plan** `/plan`
- **Parts** `/parts`
- **Progress** `/progress`
- **Export** `/export`
- **Plans** `/plans` (utility nav; legacy `/builds` redirects)

Optional Progress/Export PNGs (`progress.png`, `export.png`) can be added by extending the capture script. Older `advisor.png` / `settings-ai.png` files (if present) are leftovers from the removed in-app Kit Advisor — do not re-link them from README or Pages.

The root README embeds **light** PNGs. GitHub Pages uses theme pairs for light/dark.

| File | Spine label | Route / UI | Shows |
|------|-------------|------------|-------|
| `sources.png` | Library | `/library` | Source library: categories, sync, update badges, STL search |
| `builds.png` | Plans | `/plans` | Plans page: create, rename, duplicate, archive |
| `build.png` | Plan | `/plan` | Role filament colors, source file pickers with STL preview |
| `review.png` | Parts | `/parts` | Validation, parts with 3D previews, quantity edits |

## Prerequisites (representative data)

1. Start the app (`docker compose up --build` or local single-port run on `:8080`).
2. Add and sync at least one source with STLs.
3. Create a plan, attach the source, pick STL files, set role colors, and recompute so parts exist.

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
