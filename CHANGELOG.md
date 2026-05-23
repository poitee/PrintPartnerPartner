# Changelog

All notable changes to Print Partner are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

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

[0.2.0]: https://github.com/poitee/PrintPartnerPartner/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/poitee/PrintPartnerPartner/releases/tag/v0.1.0
