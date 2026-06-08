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
| `builds.png` | `/builds` | Plan manager: create, rename, duplicate, delete; header dropdown switches active plan |
| `build.png` | `/build` | Role filament colors, attached source cards with **Docs** viewer, file pickers feeding Update build |
| `review.png` | `/review` | Validation summary by role/filament, parts list with 3D STL previews, **Export STLs** |
| `checkoff.png` | `/checkoff` | Per-unit progress, on-scroll 3D thumbnails, **Print** / **Export checklist** / **Export missing STLs** |

## Automated capture (Playwright)

1. Run the app with representative data — e.g. `docker compose up --build` (UI on `http://localhost:8080`) or a local single-port run (see below).
2. Ensure synced sources and a populated plan (e.g. “Voron V2.4 LDO Full 300 Black”) so each page has content and Review/Checkoff show 3D previews.
3. Install capture dependencies once:

```bash
cd docs/scripts && npm install
```

4. Capture both themes:

```bash
cd docs/scripts
node capture-screenshots.mjs --theme light
node capture-screenshots.mjs --theme dark
```

Optional flags:

- `--url http://localhost:8080` — app base URL (default)
- `--out ../screenshots/light` — output directory (defaults to `docs/screenshots/{theme}/`)

The script sets `localStorage['print-partner.theme']` before load, opens `/`, then uses **client-side sidebar navigation** to each route. It waits for page content and ~2s for Three.js previews on Review and Checkoff.

## Manual capture

1. Run the app (Docker or dev).
2. In a browser at **1440×900**, set theme via **Settings** or the sidebar theme control (light / dark / system).
3. Open the app **home** (`/`), then use the sidebar to open **Sources**, **Builds**, **Build**, **Review**, and **Checkoff**. Save PNGs into `light/` or `dark/` as appropriate.

**Important:** Do not paste `/sources` (or `/build`, `/builds`, `/review`, `/checkoff`) into the address bar on a cold load in dev or Docker single-port mode — those paths are also API routes, so a full navigation can return raw JSON instead of the React UI. Client-side navigation from `/` avoids that.

Three.js renders the STL previews and Checkoff thumbnails client-side, so allow a moment for previews to load before capturing Review and Checkoff.
