# Changelog

All notable changes to Print Partner are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added

- **Published Docker images** — releases now push multi-arch (`linux/amd64` + `linux/arm64`) images to `ghcr.io/poitee/print-partner` with `latest` and version tags, so `docker compose pull && docker compose up -d` works without building from source.
- **Release workflow** — pushing a `vX.Y.Z` tag builds and publishes the image (with the version baked into `PP_VERSION`) and creates a GitHub Release with auto-generated notes (`.github/workflows/release.yml`).
- **Container healthcheck** — the app service in `docker-compose.yml` and `docker-compose.saas.yml` now polls `GET /health` via Node's built-in `fetch`.
- **Build plan management** — create, rename, duplicate, and delete plans from the Build tab (restores `PlanManager` wiring lost during the web migration).
- **Branding** — project logo (`docs/logo.png`) on the README and GitHub Pages landing page; GitHub Sponsors support badge near the top of both.
- **Regenerate thumbnails** — a button in the Build tab's "Role filament colors" section clears cached part thumbnails/previews (`POST /plans/:id/regenerate-thumbnails`) so updated colors re-render.
- **Save & import colors** — export the current role filament colors to a `print-partner-colors.json` file and import it into any plan from the Build tab.

### Changed

- **Sponsorship** — replaced Ko-fi links with [GitHub Sponsors](https://github.com/sponsors/poitee) across the app, README, and landing page; added `.github/FUNDING.yml`.
- **Thumbnail color refresh** — part thumbnail URLs now include the filament color as a cache-busting hint, so changing a role color updates previews without a hard refresh.
- **Version alignment** — `PP_VERSION` default is now `3.0.0-web` and `web/package.json` is `3.0.0`, matching the latest CHANGELOG release so the in-app update checker compares correctly against GitHub releases.

## [3.0.0-web] - 2026-05-31

Print Partner is now a **single web platform**. The **Sources → Build → Review → Checkoff** workflow moves to a TypeScript monorepo under `web/`: a Vite + React single-page app (`web/apps/web`) and a Fastify API (`web/apps/server`) served together on one port, with shared `contracts` and `domain` packages.

### Added

- **Docker self-host** — `docker compose up --build` serves the API + SPA on port 8080; data persists in the `print-partner-data` volume at `/data` (SQLite, synced repos, exports, thumbnails). Config via `PRINT_PARTNER_DATA_DIR`, `HOST`, `PORT`, `STATIC_DIR`, `DEPLOY_MODE`, `CORS_ORIGIN`/`ALLOWED_ORIGINS`, `BASIC_AUTH_USER`/`PASS`, `UPLOAD_MAX_BYTES`, `PP_VERSION`.
- **SaaS mode** (`DEPLOY_MODE=saas`) — multi-tenant hosting with Postgres app data (`DATABASE_URL`), S3-compatible blob storage (`S3_BUCKET`), GitHub OAuth, and an optional Redis/BullMQ job queue. Ready-to-run `docker-compose.saas.yml` stack (Postgres 16 + MinIO).
- **Ports/adapters architecture** — `self-host` (SQLite + local disk) and `saas` (Postgres + S3) adapters behind shared ports; Drizzle ORM with SQLite or Postgres; client-side Three.js STL rendering; background job runner with `/ws/jobs/:id` progress.
- **Desktop-data migration** — import an existing `~/.print-partner` SQLite DB and repos into the web data dir (see `web/DEPLOY.md`).

### Removed

- **Legacy desktop app** — the Python/PySide6 + Tauri desktop code, PyInstaller packaging, and desktop-only CI/docs are removed; the web platform is the canonical codebase.

### Changed

- **Documentation** — root `README.md`, `AGENTS.md`, `docs/ARCHITECTURE.md`, and the GitHub Pages landing page (`docs/index.html`) rewritten for the web platform, with regenerated workflow screenshots.

## [2.0.0] - 2026-05-31

Major release: Tauri + React desktop replaces the legacy Qt UI. Workflow is **Sources → Build → Review → Checkoff** with a quantity-aware STL exporter instead of in-app bed planning.

### Added

- **Tauri + React desktop** — primary shell with sidebar workflow, command palette (⌘K), job tray, and plan picker.
- **Build** — attach sources, pick STLs, set quantities; **role filament colors** (primary/accent/clear/opaque) with bulk apply and tinted 3D previews; **Docs** button on source cards to read synced repo READMEs.
- **Review** — editable parts list (add/remove/change quantities); validation summary; **Export STLs** by role and folder with quantity copies.
- **Checkoff** — per-unit print progress (persisted); filter missing/done; **Export missing STLs** into a rebuilt `stl-missing/` folder; checklist HTML export.
- **STL export layout** — `~/.print-partner/exports/{plan}/stl/{role}/{folder}/` and `stl-missing/` for outstanding parts only.
- **Sources** — user-managed categories, grid/list view, global STL search, remote update-check badges.
- **Settings** — configurable STL naming rules and source update interval.
- **Open data folder** — sidebar footer, Settings, and Help links to `~/.print-partner`.
- **Share build** — config-only `.print-partner-kit.zip` (no STLs); import via ⌘K.
- **License** — [Print Partner Non-Commercial Software License](LICENSE) (Annex-inspired; commercial print-farm internal use permitted); see [ATTRIBUTION.md](ATTRIBUTION.md).

### Removed

- **Legacy Qt UI** — entire `print_partner.ui` tree and PySide6 dependency.
- **Plate page and printer fleet UI** — bed assignment and 3MF plate planning removed from the desktop shell; export focuses on organized STL folders.

### Changed

- **CI/release** — engine bundles + Tauri matrix on Linux/macOS/Windows.
- **README & docs** — refreshed screenshots and workflow documentation for the four-step flow.

### Fixed

- **Recompute crash** — `compare_geometry` name shadowing in merge layers.
- **Checkoff toggles** — duplicate `print_progress` rows deduped (schema v9); stack reconcile for unit marking.
- **Export paths** — fresh `stl/` and `stl-missing/` directories on each export run.

[2.0.0]: https://github.com/poitee/PrintPartnerPartner/compare/v0.3.1...v2.0.0

## [1.0.0] - 2026-05-28

### Added

- **React Build — quantity override** — per-part stepper/input with auto vs override labels; `PATCH /parts/{id}` wired in UI.
- **React Build — STL preview panel** — click a part row to show a larger cached preview via `GET /parts/{id}/preview`.
- **Community manifest browser** — `GET /manifest-registry` lists approved entries; read-only list in Help.
- **Desktop CI** — `.github/workflows/desktop.yml` runs pytest, builds the engine on Ubuntu + macOS, and optionally runs the Vite desktop shell build on macOS.
- **Release workflow** — `release.yml` attaches Qt archives plus `print-partner-engine` Linux/macOS tarballs; optional macOS Tauri bundle (`continue-on-error`). Manual per-OS Tauri builds: [`docs/RELEASE_DESKTOP.md`](docs/RELEASE_DESKTOP.md).
- **Desktop verify script** — `packaging/verify_desktop_build.sh` checks engine binary, optional Tauri bundle, and `/health` for 5s.

### Changed

- **Version** — `1.0.0` GA for Tauri-first desktop (~80% Qt parity); beta workflow blockers cleared.
- **Part list API** — profile parts include `quantity_auto` and `quantity_override`.
- **Libraries (React)** — **Browse registry** links to community manifests on GitHub.

### Notes

- Full **`npm run tauri build`** on Windows/Linux remains a **manual release step**; macOS may succeed in CI but is not required. See [`docs/RELEASE_DESKTOP.md`](docs/RELEASE_DESKTOP.md) and [`docs/RELEASE_1.0.0_CHECKLIST.md`](docs/RELEASE_1.0.0_CHECKLIST.md).

## [1.0.0-beta.1] - 2026-05-28

### Added

- **Tauri desktop as default CLI** — `print-partner` launches the built Tauri app when `dist/Print Partner.app` (macOS) or `dist/print-partner-desktop` exists; falls back to Qt with a deprecation warning. Dev helper: `scripts/launch_desktop.sh`.
- **Engine APIs** — `GET /filaments/catalog` (Ambrosia + custom colors), `GET /help/workflow` (markdown workflow guide). OpenAPI at `/openapi.json`.
- **React Build** — per-part filament picker (catalog + custom colors from Settings).
- **React Print** — assignment summary table by printer; improved printer dropdown with enabled/other groups.
- **React Help** — workflow guide loaded from engine; OpenAPI URL shown in Help.
- **OpenAPI client script** — `apps/desktop/scripts/generate-api-client.sh`.
- **Legacy Qt docs** — [`docs/LEGACY_QT.md`](docs/LEGACY_QT.md) for `PRINT_PARTNER_USE_QT=1`.

### Changed

- **Version** — `1.0.0-beta.1` toward v1.0 Tauri cutover (~78% Qt parity).
- **Desktop dev docs** — launcher behavior, catalog/help endpoints, OpenAPI workflow in [`DESKTOP_DEV.md`](docs/DESKTOP_DEV.md).

## [0.4.0] - 2026-05-28

### Added

- **Kit manifest system** — `print-partner.manifest.yaml` at repo root; load/validate/apply in core; **Kit → Manage → Manifest…** editor with option groups, drift warnings after recompute, and **Generate manifest draft** from README + scan.
- **Community manifest registry** — `manifests/` in this repo with PR template, `registry/index.yaml`, and **Import community manifest…** in the app.
- **Performance** — mesh load cache in export pipeline; per-project scan cache keyed by commit SHA; parallel remote update checks; **Help → Fast recompute** (skip geometry compare on Recompute).
- **Parts tree virtualization** — `QTreeView` + `QAbstractItemModel` for large kits (5k+ rows); collapse-all when >500 parts with summary hint.
- **ProfileComposer mixins** — `export_actions.py` and `checkoff_actions.py` extracted from the composer hub.

### Changed

- **License docs** — [PolyForm Noncommercial 1.0.0](LICENSE) with [LICENSE-SUMMARY.md](LICENSE-SUMMARY.md) and [COMMERCIAL.md](COMMERCIAL.md); Help menu entries for overview and full license text.
- **Workflow guide** — manifest curation and fast recompute documented; duplicate Recompute control removed from layers panel (header + Ctrl+R remain).
- **GitHub Pages** — static landing at `docs/index.html` deployed via `pages.yml`.

### Fixed

- Build wizard addon navigation guards invalid `nextId` transitions.

## [0.3.1] - 2026-05-24

### Added

- **Custom filaments** — Named colors in a local library; export/import library JSON; bundled in shared kit exports.
- **Repo list sharing** — Export/import repository list JSON (Libraries → More).
- **Print: assign folder** — Select a repo/folder row and assign all parts to a printer; 3MF plates group and name by filament · repo · folder.
- **Ko-fi support** — Optional tip link in workflow bar and Help menu; Support section in README.
- **Checkoff print tracking** — Per-unit printed counts save to the kit; filter all/missing/done; **Print missing →** loads unfinished units on the Print tab; **Export missing 3MF…** for slicer plates; in-tab guide for exports.

### Changed

- **Libraries / Kit / Print / Checkoff UI** — Clearer step guides, tooltips, wider readable columns, simplified part filters, tighter checkoff layout, and checkoff export help copy.
- **License & notices** — Non-commercial license, third-party notices, in-app Help entries, bundled in release builds.

### Fixed

- Circular import in plate packer when grouping plates by location.

## [0.3.0] - 2026-05-24

### Added

- **3MF export** — Multi-printer **Print** tab: fleet bed sizes, loaded filament per machine, manual assign from an unclassified pool to printers, auto-assign by filament, bin-pack per plate; export per-plate `.3mf`, zip, or single-file modes.
- **Printer fleet** — Presets, bed sizes, loaded spool slots; persisted per kit print plan.
- **Release automation** — Reusable GitHub Actions build workflow, version/CHANGELOG gates, **Release (create tag)** dispatch, CHANGELOG-based release notes.
- **Workflow guide** — Numbered workflow strip with gating, breadcrumbs, status bar, and onboarding copy.
- **Industrial UI polish** — Palette-aware light/dark styling, banners, consolidated toolbars, richer parts/repo trees.

### Changed

- **Kit Compose** — Removed suggestions panel from compose flow; parts summary in toolbar.
- **Print tab** — Two-panel assign UI (unclassified ↔ printers) instead of nested plate tree editor.

### Fixed

- Theme text contrast in dark mode (palette-based QSS instead of hardcoded grays).
- CI: Ruff import/unused fixes; repo import dialog test reads UTF-8 on Linux.

## [0.2.0] - 2026-05-23

### Added

- **Kit sharing** — Export/import `.print-partner-kit.zip` bundles (layers, parts, filament, notes; no print progress).
- **AI assistant** (optional) — OpenAI/Anthropic-compatible chat, suggestions review, and offline heuristics panel on Kit Compose.
- **Workflow strip** — Libraries → Kit (Compose / Review) → Checkoff navigation with keyboard shortcuts (Ctrl+1/2/3, Ctrl+R, F1).
- **Toasts** and inline banners replacing many success modal dialogs.
- **First-run dialog**, path picker, remote sync chip, kit library empty states, and profile suggestions panel.
- **Structured logging** (`logging_setup`) across workers and CLIs.
- **Formal DB migrations** (`schema_version` in app settings, ordered `SCHEMA_MIGRATIONS`).
- **CI** — Full-repo ruff, pytest on Ubuntu/macOS (3.11/3.12), Windows (3.11); release workflow for tagged builds.
- **Packaging** — DMG/notarize scripts, artifact packaging, macOS NumPy verification, release smoke-test doc.
- **Docs** — `docs/ARCHITECTURE.md`, release README, thumbnail/bundle notes.

### Changed

- **Checkoff & HTML export** — Print-optimized letter layout: document header, filament color swatch on each part row (tooltip for full name), wider Print/Verify columns, solid thumbnails with outer outline only (`THUMB_CACHE_VERSION` v3).
- **Checkoff UI** — Theme-aware styling (palette colors for light/dark mode); removed progress summary bar and filament legend.
- **Profile composer** — Split into `ui/composer/` mixins; main window uses stacked content (no widget reparenting).
- **Python** — `requires-python >= 3.11`; expanded ruff configuration.

### Fixed

- Kit list **Duplicate** now prompts for a name.
- Datetime handling uses `timezone.utc` for broader compatibility.
- Various import/sync and test coverage improvements.

## [0.1.0] - 2025

### Added

- Initial release: GitHub STL libraries, layered kits, merge engine, PySide6 UI, HTML export, SQLite persistence, Source–Build–Verify–Checkoff workflow.

[0.3.0]: https://github.com/poitee/PrintPartnerPartner/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/poitee/PrintPartnerPartner/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/poitee/PrintPartnerPartner/releases/tag/v0.1.0
