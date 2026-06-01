# Screenshots

Workflow screenshots of the Print Partner web app, used by the root [README](../../README.md) and the GitHub Pages landing page ([`../index.html`](../index.html)). Captured from the running app at a consistent window size.

| File | Route | Shows |
|------|-------|-------|
| `sources.png` | `/sources` | Source library: categories, sync status, update-available badges, global STL search |
| `build.png` | `/build` | Role filament colors, attached source cards with **Docs** viewer, file pickers feeding Update build |
| `review.png` | `/review` | Validation summary by role/filament, parts list with 3D STL previews, **Export STLs** |
| `checkoff.png` | `/checkoff` | Per-unit progress, on-scroll 3D thumbnails, **Print** / **Export checklist** / **Export missing STLs** |

## Capture

1. Run the app with representative data — e.g. `docker compose up --build` (UI on `http://localhost:8080`) or `cd web && npm run dev` (UI on `http://localhost:5173`).
2. Ensure synced sources and a populated plan (e.g. "Voron V2.4 LDO Full 300 Black") so each page has content.
3. In a browser at **1440×900**, open the app **home** (`/` or `/build?profile=…`), then use the sidebar to open **Sources**, **Build**, **Review**, and **Checkoff**. Capture each viewport into this folder.

**Important:** Do not paste `/sources` (or `/build`, `/review`, `/checkoff`) into the address bar on a cold load in dev or Docker single-port mode — those paths are also API routes, so a full navigation can return raw JSON instead of the React UI. Client-side navigation from `/` avoids that.

Three.js renders the STL previews and Checkoff thumbnails client-side, so allow a moment for previews to load before capturing.
