# Changelog

All notable changes to Print Partner are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

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
