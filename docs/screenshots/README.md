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

Checkoff/Production PNGs (`progress.png`, `export.png`) are captured by the current script and embedded from README and GitHub Pages. Older `advisor.png` / `settings-ai.png` files (if present) are leftovers from the removed in-app Kit Advisor — do not re-link them from README or Pages.

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
3. **New Build**, attach the source on Sources, pick STL files and quantities, then **Apply** on Plan so accepted parts exist.

Optional: pass `--profile-id N` to select a specific Build when multiple exist.

To seed a representative Source, accepted Build, and unbound Printer, then capture both themes:

```bash
node web/apps/web/test/browser/capture-fixture-screenshots.mjs
```

## Automated capture (Playwright)

The capture script uses system Chrome when `PLAYWRIGHT_CHROMIUM_EXECUTABLE` is set
(or `/usr/bin/google-chrome`). To use Playwright's bundled Chromium instead:

```bash
cd docs/scripts && npm install && npx playwright install chromium
```

Capture one theme against an already-running app:

```bash
node docs/scripts/capture-screenshots.mjs --theme light --profile-id 1
node docs/scripts/capture-screenshots.mjs --theme dark --profile-id 1
```

Optional flags:

- `--url http://localhost:8080` — app base URL (default)
- `--out ../screenshots/light` — output directory (defaults to `docs/screenshots/{theme}/`)
- `--profile-id 1` — append `?profile=1` on first load

**Important:** Do not paste `/library` (or `/plan`, `/parts`, `/progress`, `/plans`, `/settings`) into the address bar on a cold load in Docker single-port mode — some paths are also API routes. Client-side navigation from `/` avoids that.

Three.js renders STL previews client-side; allow a moment for previews to load before capturing Plan.
