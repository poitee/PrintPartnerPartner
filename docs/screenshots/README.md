# Screenshots

Workflow screenshots of the Print Partner web app, used by the root [README](../../README.md) and the GitHub Pages landing page ([`../index.html`](../index.html)). Captured from the running app at a consistent window size.

| File | Route | Shows |
|------|-------|-------|
| `sources.png` | `/sources` | Source library: categories, sync status, update-available badges, global STL search |
| `build.png` | `/build` | Role filament colors, attached source cards with **Docs** viewer, file pickers feeding Update build |
| `review.png` | `/review` | Validation summary by role/filament, parts list with 3D STL previews, **Export STLs** |
| `checkoff.png` | `/checkoff` | Per-unit progress, on-scroll 3D thumbnails, **Print** / **Export checklist** / **Export missing STLs** |

## Capture

1. Run the app. Either start the dev servers (`cd web && npm run dev`, UI on `http://127.0.0.1:5173`), or build and run the single-port container (`docker compose up --build`, app on `http://localhost:8080`).
2. Ensure demo data exists — synced sources and a populated plan (e.g. "Voron V2.4 LDO Full 300 Black") so each page has representative content.
3. Open each route (`/sources`, `/build`, `/review`, `/checkoff`) in a browser at a consistent window size and capture the viewport into this folder, overwriting the four PNGs above.

Three.js renders the STL previews and Checkoff thumbnails client-side, so allow a moment for previews to load before capturing.
