# Cleanup manifest

## Goal

Remove code, packages, and documentation that the current product does not use. Keep compatibility code until its callers and stored data have a tested migration.

Cleanup is complete when:

- every candidate in this document has a disposition;
- all `remove now` entries are gone;
- every deferred removal names the feature that must replace it;
- database upgrade paths, old deep links, MCP clients, and exported object identity still work;
- `npm run quality`, Compose validation, the manifest tests, and `node scripts/audit-cleanup.mjs` pass;
- local inline Markdown file targets resolve;
- `npm audit` reports no high or critical vulnerabilities;
- current product documentation no longer describes removed behavior as available.

## Rules

1. A zero-import report is a lead, not proof. Package scripts, public assets, dynamic registration, database rows, and external clients can be callers.
2. Do not delete a database table or historical migration in place. Remove readers and writers first, then add a versioned migration.
3. Do not delete a current page merely because the accepted redesign replaces it. Build the replacement, migrate the behavior, and then remove the old page in the same change.
4. Preserve 3MF Object names, Required unit identity, Checkoff output, Source revision history, and printer-job history through every cleanup wave.
5. Run the narrow test for each change before the full suite.

## Baseline

- `npm ci` completed with Node 22 and npm 10.
- Lint, typecheck, contracts tests, domain tests, and frontend tests passed before cleanup.
- Server tests had one platform-specific failure. macOS resolved an existing backup path from `/var/...` to `/private/var/...`; the product response was correct.
- Server result before the test repair: 124 files passed, 1 failed, 1 skipped; 782 tests passed, 1 failed, 2 skipped.
- The focused backup route test passes after normalizing the expected existing path with `realpathSync()`.
- `npm audit` reports four moderate development-only findings, all through `drizzle-kit` and its deprecated esbuild loader chain. It reports no high or critical findings.
- `npm outdated --workspaces` reports patch or minor updates within current ranges, plus major updates that need separate compatibility work.
- `npx knip` and `node scripts/audit-cleanup.mjs` provide independent static-use inventories. Neither one authorizes deletion on its own.
- Knip fix mode is not safe for this repository. It misclassifies namespace schema exports and private module entrypoints, so use its report only as a lead and verify every caller with the compiler and targeted searches.

## Remove now

| Area | Candidate | Evidence | Replacement or reason | Verification |
|---|---|---|---|---|
| Frontend | `web/apps/web/src/pages/ReviewPage.tsx` | No imports. `/review` redirects directly to `/parts`. | No module replacement needed. Keep the redirect until the new Build routes land. | Frontend typecheck, route tests, build |
| Frontend CSS | Unreferenced legacy selectors in `App.css` | Exact selector searches found no JSX, TSX, HTML, or test callers. | Current component classes and protected Checkoff print CSS remain. | Frontend tests and build |
| Search | SearXNG provider implementation and configuration | The implementation has no caller. Selecting `searxng` falls through to DuckDuckGo while reporting the wrong provider. | Keep Brave, Exa, DuckDuckGo, native provider search, and disabled mode. Normalize a persisted `searxng` setting at the assistant configuration boundary to the former DuckDuckGo fallback, and cover an old stored integration record in `resolve-assistant.test.ts`. | Search, config, contracts, and server tests |
| Tooling | `drizzle.config.ts`, `db:generate`, and `drizzle-kit` | No generated Drizzle directory and no caller outside the unused package script. Runtime uses `drizzle-orm`, not `drizzle-kit`. | Keep the current versioned schema/migration code. | DB tests, typecheck, build, audit |
| Packages | Verified unused direct dependencies | `knip` plus exact import searches found no callers. | Add `pino` as a direct dependency because shipped logger code imports it. | Clean install, `knip`, quality, audit |
| Tests | Backup restore JSON path assertion | `/var` and `/private/var` are the same path on macOS. | Compare the existing file's canonical path. | Focused test and server suite |
| Docs | Broken current local links | The cleanup audit found 12 missing inline file targets. | Point current docs at live files. Render historical changelog paths as text when the removed document is part of history. | Cleanup audit reports zero missing local inline file targets |
| Tooling | Cleanup audit script | The repo had no repeatable dead-file, duplicate-file, or local-link inventory. | Keep `scripts/audit-cleanup.mjs` read-only and deterministic. | Run from the repository root |

## Decide before removal

| Candidate | Why it needs a product decision |
|---|---|
| `IncomingSharesCard.tsx` | The component is orphaned, but outgoing sharing and the server acceptance routes are live. Either place incoming shares in the new Builds screen or retire sharing as a whole feature. |
| `docs/research/` and `web/apps/server/src/data/assistant-domain/` | 130 files are byte-identical. One tree is authoring material and one is shipped runtime data, but there is no generator that names the authority. Choose the authority before removing duplication. |
| Old `.superpowers/sdd` reports and August 17 to 18 implementation plans | They have no runtime callers and several contradict the shipped product. Git already preserves them, but deleting historical work records is a repository policy choice. |
| Golden-stack examples and old playbooks | Several links are broken and the text uses old workflow names. Rewrite them against the accepted Source and Build model or remove the examples after confirming they are not published user documentation. |
| `capture-digest-fixtures.ts` and `e2e/verify_auto_slice.ts` | They are standalone maintainer tools, not imported modules. The first is undocumented. The second supports the deferred auto-slicer. |
| `scripts/import-sqlite.ts` | Knip reports it as unused, but it is a standalone data migration command. Removing it requires a supported Postgres import decision. |
| `printerNameMap` | No reader caller or writer exists, but installed databases can contain rows. Remove only with a versioned migration after checking real database counts. |
| `slicer_folder` integration | Its adapter always returns `not implemented yet`, but persisted integrations may use the type. Migrate stored rows before deleting the contract value. |

## First cleanup wave

Completed on August 20, 2026:

- removed the unwired SearXNG option, unused Drizzle generator, orphaned Review page, verified dead CSS, and unused direct packages listed above;
- added `pino` as a direct server dependency because the shipped logger imports it;
- updated direct dependencies that remained compatible with the current runtime and test setup, including the AWS S3 client, Fastify, Lucide, Vitest, PostgreSQL types, and Three.js types;
- declared the server's Fastify version in the workspace tool package as well, so npm hoists one Fastify type identity beside the hoisted Fastify plugins on a clean install;
- regenerated both third-party notice copies from the dependency manifests resolved in each npm workspace;
- repaired 12 broken local documentation links and the macOS backup-path assertion;
- made browser fixture checks find common Chrome and Chromium installations on macOS and Linux;
- reduced `npm audit` from four moderate development-only findings to zero findings.

The following dependency majors remain deferred because they change a runtime or compiler boundary: Node types 26, TypeScript 7, `better-sqlite3` 13 and its type package, Chokidar 5, and jsdom 30. Upgrade each in a focused compatibility change with its own tests rather than folding it into dead-code cleanup.

## Remove after the redesign replaces it

- Current Parts, Export, Welcome, and Plans page shells.
- The five-stage workflow rail, tray, command-palette actions, and old route names.
- Automatic source application and automatic Build recompute.
- Automatic printer selection, loaded-filament scoring, and first-printer fallback.
- Custom filament management when Spoolman is absent.
- Printer-owned slicer, process, and filament profile assignment.
- Auto-slice jobs, Docker slicer controls, and profile synchronization after local 3MF handoff covers the accepted workflow.
- Printer controls embedded in Checkoff after Production owns them.
- Settings copies of Printer and Source Library management after their global sections own setup.

These modules are live today. Deleting them now would remove working behavior before the accepted Build and Production screens exist.

## Keep

- Source CRUD, import, sync, monitoring, and durable directory/file rules.
- Build Plan, Required unit, Checkoff, printer-job, and history data.
- Moonraker, PrusaLink, Bambu handoff/status, Home Assistant, Spoolman, MCP, API v1, and local/SaaS adapters.
- Manual printer upload and dispatch mechanics.
- 3MF named-object export, STL bundle export, and explicit Plate layouts.
- SQLite and Postgres historical migrations, legacy export migration, and persisted-state readers needed for supported upgrades.
- Old route redirects until the new canonical route map exists.

## Verification order

1. Run each affected focused test.
2. Run `node scripts/audit-cleanup.mjs` and inspect `npx knip --reporter compact` without `--fix`.
3. Run `npm run quality` from `web/`.
4. Validate `docker-compose.yml`, `docker-compose.saas.yml`, and the `docker-compose.yml` plus `pp-compose.yml` overlay.
5. Run the Python manifest validation suite in an isolated environment.
6. Inspect the production build and exercise the primary workflow in the running app before removing migration-coupled UI.

The cleanup audit does not validate reference-style Markdown links, heading fragments, or external URLs. Its zero count applies only to local inline file targets.
