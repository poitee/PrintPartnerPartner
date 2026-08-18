# Runtime Debug Report: Backup, Phase Progress, Service Worker, and Icons

Date: 2026-08-18  
Branch: `cursor/full-codebase-audit-2c41`  
Baseline SHA: `965ec17`  
Implementation SHAs: `2eb0a26`, `c5dc46f`

## Scope

This investigation covered:

1. Settings Backup & Restore requests returning Vite HTML instead of backend JSON.
2. Progress reporting a 404 when a valid plan has no optional phase manifest.
3. Service worker Cache API errors caused by ordinary non-GET requests entering cache strategies.
4. Missing favicon/PWA icon assets.
5. Other operational Fastify route prefixes omitted from the Vite development proxy.

No persistent debug logging was needed. HTTP probes, browser runtime interception, and executable regression tests isolated each component boundary without logging secrets or modifying runtime timing.

## Hypotheses and Results

### H1 — `/backups` is missing from the Vite proxy

Status: **CONFIRMED**

Before the fix:

- `GET http://127.0.0.1:18765/backups` returned `200 application/json` with `[]`.
- `GET http://127.0.0.1:5173/backups` returned `200 text/html`, 1,979 bytes, beginning with `<!doctype html>`.

The backend route was healthy. Vite did not proxy `/backups`, so SPA fallback HTML reached `response.json()`.

### H2 — Additional operational route prefixes are also missing

Status: **CONFIRMED**

The live OpenAPI inventory included operational top-level routes absent from `API_PREFIXES`. Before the fix, Vite returned SPA HTML for:

- `/assistant/status`
- `/exports/...`
- `/metrics`
- `/slicer-profile-options`
- `/api/discord-digest`

Source inspection also found active browser calls to `/assistant`, `/profile-library`, `/slicer-profile-options`, and server-produced `/exports` URLs. The proxy now includes `/admin`, `/api`, `/assistant`, `/backups`, `/exports`, `/mcp`, `/metrics`, `/profile-library`, and `/slicer-profile-options`.

After the fix, live Vite probes returned backend content:

- `/backups`: `200 application/json`
- `/assistant/status`: `200 application/json`
- `/profile-library`: `200 application/json`
- `/slicer-profile-options`: `200 application/json`
- `/metrics`: `200 text/plain; version=0.0.4`

### H3 — The phase-manifest 404 is an optional-absence case treated as a generic failure

Status: **CONFIRMED**

Plan `1` was valid:

- `GET /plans/1`: `200 application/json`
- `GET /plans/1/phase-manifest`: `404 application/json`

`engineFetch` discarded HTTP status by throwing a plain `Error`, and `fetchPlanPhaseManifest` did not implement its documented empty-manifest fallback. It now preserves status in `EngineHttpError`; `fetchPlanPhaseManifest` maps only status 404 to:

```json
{"profile_id":1,"has_phases":false,"phases":[]}
```

All other statuses are rethrown. Browser verification showed the real backend 404 produced no “Could not load phase progress” alert. A browser-intercepted 500 with `{"detail":"phase manifest exploded"}` produced the alert `Could not load phase progress: phase manifest exploded`.

### H4 — Ordinary POST/PUT/DELETE requests fall through to `cacheFirst`

Status: **CONFIRMED**

The fetch listener handled checkoff mutations specially, but all other requests fell through to `cacheFirst`, regardless of method. Cache API `match`/`put` only accepts GET requests.

The service worker now:

1. Preserves the existing offline queue for checkoff mutations.
2. Returns without interception for every other non-GET request.
3. Applies network-first/cache-first only to GET requests.
4. Uses cache version `v2` so existing clients activate the corrected worker.

Runtime browser verification confirmed the page was service-worker controlled and an ordinary POST completed with its network 404 without any Cache API/`post` console error.

### H5 — Referenced icon PNGs are missing

Status: **CONFIRMED**

Before the fix:

- `/icons/icon-192.png` returned SPA HTML.
- `/favicon.ico` returned 404.
- `manifest.json` and the Apple touch icon referenced missing `icon-192.png`/`icon-512.png`.

The existing deterministic generator produced both PNGs, and `index.html` now references the existing SVG as the favicon. Live requests return:

- `/icons/icon-192.png`: `200 image/png`, 813 bytes
- `/icons/icon-512.png`: `200 image/png`, 3,243 bytes
- `/icons/icon.svg`: `200 image/svg+xml`

## Adjacent Backup Contract Findings

Proxying alone would not have made the card operational:

- The server returns an array of `{name, size, createdAt}`, while the card expected `{backups: [...]}` with `{id, timestamp, size}`.
- The UI and operations documentation restore a stored backup with JSON `{backupName}`, while the server route accepted only multipart upload.

The card now consumes the server list contract. The restore route accepts a safely validated stored backup name as JSON while retaining multipart upload support. Traversal names are rejected before restore, and missing files return 404.

## TDD Evidence

Red phase:

- Web regressions: 7 intended failures, covering proxy prefixes, optional phase 404, unsafe service-worker routing, backup list shape, and icon references.
- Server regressions: 2 intended failures, where JSON restore returned 500 instead of expected 200/400.

Green phase:

- Focused web: 5 files, 9 tests passed.
- Focused server backup suite: 4 files, 17 tests passed.

## Full Verification

`npm run quality` passed after the implementation checkpoint:

- ESLint: passed.
- Server and web TypeScript checks: passed.
- Contracts: 13 tests passed.
- Domain: 127 tests passed.
- Web: 81 files, 363 tests passed.
- Server: 123 files passed, 1 skipped; 771 tests passed, 2 skipped.
- Workflow smoke: 4 tests passed.
- Contracts/domain/server/web production builds: passed.
- Browser skip-link test: passed.

The first quality run exposed a test-import typing issue in `vite.config.ts`: importing the config into a regression test made TypeScript validate the existing `test` property against Vite's narrower `defineConfig`. Switching to `defineConfig` from `vitest/config` resolved that issue; the complete pipeline then passed.

## Concerns

- The live backend currently has no registered phase-manifest route, so 404 is the only available representation of optional absence. The client intentionally suppresses only 404; real server failures remain visible.
- A real destructive restore was not run against the working development data. Route selection/path validation is covered by focused tests, while archive restore integrity and rollback behavior remain covered by the existing backup service integration suite.
- Existing open tabs may make one additional request through the old service worker before `v2` activates; `skipWaiting()` and `clients.claim()` minimize that transition.
