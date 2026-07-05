# Screenshots

Workflow screenshots of the Print Partner web app, used by the root [README](../../README.md) and the GitHub Pages landing page ([`../index.html`](../index.html)). Captured from the running app at **1440×900**.

## Layout

```text
docs/screenshots/
  light/   sources.png builds.png build.png review.png checkoff.png
  dark/    (same filenames)
  README.md
```

The root README embeds **light** PNGs (readable on GitHub’s default UI). GitHub Pages uses `<picture>` elements to swap in **dark** PNGs when the visitor prefers dark mode.

| File | Route | Shows |
|------|-------|-------|
| `sources.png` | `/sources` | Source library: categories, sync status, update-available badges, global STL search |
| `builds.png` | `/builds` | **Builds** page: active-build dropdown, create, rename, duplicate, delete |
| `build.png` | `/build` | **Manage builds** panel expanded, role filament colors, source file pickers with STL preview |
| `review.png` | `/review` | Validation summary by role/filament, parts list with 3D STL previews, Export STLs |
| `checkoff.png` | `/checkoff` | Per-unit progress, on-scroll 3D thumbnails, Print / Export checklist / Export missing STLs |

## Prerequisites (representative data)

Before capturing, run the app with a populated plan so Review and Checkoff show 3D previews:

1. Start the app (`docker compose up --build` or local single-port run on `:8080`).
2. Add and sync at least one source with STLs.
3. Create a build, attach the source, pick STL files, set role colors, and run **Update build** so parts exist.

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

The script sets `localStorage` before load:

- `print-partner.theme` — light or dark
- `print-partner.sidebar.ui.v1` — `0` (sidebar expanded)
- `print-partner.workflow.onboarding.v1` — `1` (hide first-run Progress widget)

It opens `/`, navigates via the sidebar (primary pipeline links + **Builds** in the secondary section), expands **Manage builds** on Build before capture, and waits for Three.js canvases on Review and Checkoff.

## Manual capture

1. Run the app (Docker or dev).
2. In a browser at **1440×900**, set theme via **Settings** or the sidebar/header theme control.
3. Open the app **home** (`/`), then use the sidebar to open **Sources**, **Builds**, **Build**, **Review**, and **Checkoff**. Expand **Manage builds** on Build. Save PNGs into `light/` or `dark/` as appropriate.

**Important:** Do not paste `/sources` (or `/build`, `/builds`, `/review`, `/checkoff`) into the address bar on a cold load in dev or Docker single-port mode — those paths are also API routes, so a full navigation can return raw JSON instead of the React UI. Client-side navigation from `/` avoids that.

Three.js renders STL previews and Checkoff thumbnails client-side; allow a moment for previews to load before capturing Review and Checkoff.
