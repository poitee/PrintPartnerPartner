# Screenshots

Workflow and AI screenshots of the Print Partner web app, used by the root [README](../../README.md), [KIT_ADVISOR.md](../KIT_ADVISOR.md), and the GitHub Pages landing page ([`../index.html`](../index.html)). Captured from the running app at **1440×900**.

## Layout

```text
docs/screenshots/
  light/   sources.png builds.png build.png review.png progress.png settings-ai.png advisor.png
  dark/    (same filenames)
  README.md
```

Filenames are stable for README / GitHub Pages embeds. Sidebar labels and routes are **Library** (`/library`), **Plan** (`/plan`), **Parts** (`/parts`), **Progress** (`/progress`), plus **Builds** (`/builds`) outside the workflow `<nav>`.

`progress.png` is captured by [`../scripts/capture-screenshots.mjs`](../scripts/capture-screenshots.mjs). If the PNG is missing from `light/` or `dark/`, re-run the capture script — embeds may 404 until then. Older `checkoff.png` files (if present) are leftover from when Checkoff was a separate sidebar page; print checkoff now lives on **Progress**.

The root README embeds **light** PNGs (readable on GitHub’s default UI). GitHub Pages uses `<picture>` elements to swap in **dark** PNGs when the visitor prefers dark mode.

| File | Sidebar label | Route / UI | Shows |
|------|---------------|------------|-------|
| `sources.png` | Library | `/library` | Source library: categories, sync status, update-available badges, global STL search |
| `builds.png` | Builds | `/builds` | **Builds** page: active-build dropdown, create, rename, duplicate, delete |
| `build.png` | Plan | `/plan` | **Manage builds** panel expanded, role filament colors, source file pickers with STL preview |
| `review.png` | Parts | `/parts` | Validation, parts with 3D previews, quantity edits, exports |
| `progress.png` | Progress | `/progress` | Print checkoff: per-unit progress, filters, printable checklist |
| `settings-ai.png` | Settings | `/settings` | **AI assistant** card (provider, search, budgets) |
| `advisor.png` | Header **Advisor** | Kit advisor sheet | Kit advisor sheet open beside the workflow |

## Prerequisites (representative data)

Before capturing, run the app with a populated plan so Parts shows 3D previews:

1. Start the app (`docker compose up --build` or local single-port run on `:8080`). Prefer **building from this checkout** so Settings includes the current AI assistant card.
2. Add and sync at least one source with STLs.
3. Create a build, attach the source, pick STL files, set role colors, and run **Update build** so parts exist.
4. Optional but recommended for AI shots: configure **Settings → AI assistant** (Ollama or a cloud key) so the header **Advisor** button appears (`health.capabilities` includes `ai_assistant`).

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

It opens `/`, navigates via the sidebar (Library / Builds / Plan / Parts / Progress / Settings), opens the header **Advisor** for the kit advisor shot, expands **Manage builds** on Plan, and waits for Three.js canvases on Parts. Builds is clicked from `aside` (outside the workflow `<nav>`).

## Manual capture

1. Run the app (Docker or dev).
2. In a browser at **1440×900**, set theme via **Settings** or the sidebar/header theme control.
3. Open the app **home** (`/`), then use the sidebar to open **Library**, **Builds**, **Plan**, **Parts**, **Progress**, and **Settings** (scroll to **AI assistant**). Open **Advisor** from the header. Save PNGs into `light/` or `dark/` as appropriate (keep the filenames above).

**Important:** Do not paste `/library` (or `/plan`, `/parts`, `/progress`, `/builds`, `/settings`) into the address bar on a cold load in Docker single-port mode — some paths are also API routes, so a full navigation can return raw JSON instead of the React UI. Client-side navigation from `/` avoids that.

Three.js renders STL previews client-side; allow a moment for previews to load before capturing Parts.
