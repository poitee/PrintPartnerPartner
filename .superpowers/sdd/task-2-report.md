# Task 2 report: Tenant isolation, atomic mutations, and bounded jobs

## Status

DONE

Branch: `cursor/full-codebase-audit-2c41`

Implementation HEAD before this report: `b3cec62403c051c486081d9dc0423d5f9a761953`

## Audit claim verification

The pre-change code confirmed every Task 2 claim:

- Profile-derived queries and mutations such as recompute, parts, layers, bundle
  export, decisions, snapshots, and print-job history could accept a profile id
  without first proving `getProfile(id)` was visible to the request tenant.
- In-process jobs stored the tenant only inside the payload; `get`, `list`, and
  `subscribe` did not enforce it, so another tenant could poll or subscribe by
  job id and could see all jobs through the v1 list route.
- Terminal job snapshots were never removed from the three in-memory maps.
- SQLite recompute performed deletes and inserts without a native transaction.
  An injected insert failure left the earlier deletes committed.
- SQLite detection checked `db.select().all` before a table was attached. That
  method is undefined on Drizzle's incomplete select builder, so even the
  existing transaction helper incorrectly selected its non-transaction path.
- The Postgres repository uses a synchronous promise bridge and cannot safely
  provide native ACID transaction semantics for repository mutations.
- The synthetic SaaS `anonymous/anonymous` identity passed the Task 1
  authenticated-session predicate.
- MCP's nested pre-handler compared only the environment key with ordinary
  string equality, rejecting settings-created keys after the shared API hook
  had accepted them.

## Implementation

- Added a repository ownership assertion and applied it before profile-id
  scoped repository reads and writes.
- Rejected profile-scoped job starts for missing or cross-tenant profiles.
- Stored job tenant ownership separately from payload data and required it for
  job get, v1 list/artifact reads, cancellation, and WebSocket subscription.
- Added terminal-job retention with a 1,000-snapshot cap and 24-hour TTL while
  leaving active jobs outside pruning.
- Wrapped SQLite recompute mutations, manifest application, and recompute
  timestamp updates in the native Drizzle transaction.
- Corrected native SQLite driver detection so the transaction path is actually
  selected.
- Added `POSTGRES_EXPERIMENTAL=1` as an explicit production gate. Production
  SaaS with `DATABASE_URL` fails closed without it; health reports
  `db.support_status`, and deployment/architecture docs no longer claim
  production-ready Postgres support.
- Reused the shared timing-safe configured/settings API-key validator for MCP.
- Excluded the synthetic SaaS anonymous identity from authenticated-session
  bypasses.

## Red evidence

`npm run test -w @print-partner/server -- phase6 jobs recompute`

- Exit 1 before implementation.
- 4 intended failures: cross-tenant profile recompute/export access, SQLite
  rollback, cross-tenant job get/list, and unbounded terminal snapshots.

`npm run test -w @print-partner/server -- api-key http-routes config`

- Exit 1 before implementation.
- 3 intended failures: synthetic SaaS anonymous received 200 instead of 401,
  settings-created MCP key received 503 instead of 200, and the Postgres
  experimental gate/status was absent.

`npm run test -w @print-partner/server -- phase5`

- Exit 1 before implementation.
- Health omitted `db.support_status`.

`npm run test -w @print-partner/server -- phase6`

- Exit 1 during self-review after adding broader entry-point coverage.
- `listParts` did not yet reject a cross-tenant profile id; the same guard was
  then applied to decisions, snapshots, source-note profile associations, and
  print-job profile operations.

## Green and final verification

Focused tenant/recompute suite:

`npm run test -w @print-partner/server -- phase6 jobs recompute`

- Exit 0; 3 files and 6 tests passed.

Focused authentication/status suite:

`npm run test -w @print-partner/server -- api-key http-routes config phase5`

- Exit 0; 5 files and 36 tests passed.

Final complete server suite:

`npm run test -w @print-partner/server`

- Exit 0; 114 files passed, 1 skipped; 728 tests passed, 2 skipped.

Server typecheck:

`npm run typecheck -w @print-partner/server`

- Exit 0; no TypeScript diagnostics.

Lint:

`npm run lint`

- Exit 0; no ESLint diagnostics.

Diff hygiene:

`git diff --check 5915f9e..HEAD`

- Exit 0.

## Files

Production and configuration:

- `web/apps/server/src/app.ts`
- `web/apps/server/src/config.ts`
- `web/apps/server/src/db/repository.ts`
- `web/apps/server/src/db/sync-db-bridge.ts`
- `web/apps/server/src/mcp/http-routes.ts`
- `web/apps/server/src/middleware/api-key.ts`
- `web/apps/server/src/ports/index.ts`
- `web/apps/server/src/routes/api-v1-extensions.ts`
- `web/apps/server/src/routes/api-v1.ts`
- `web/apps/server/src/routes/health.ts`
- `web/apps/server/src/routes/jobs.ts`
- `docker-compose.saas.yml`

Tests:

- `web/apps/server/src/config.test.ts`
- `web/apps/server/src/mcp/http-routes.test.ts`
- `web/apps/server/src/middleware/api-key.test.ts`
- `web/apps/server/src/phase5.test.ts`
- `web/apps/server/src/phase6.test.ts`
- `web/apps/server/src/routes/auto-slice-route.test.ts`
- `web/apps/server/src/routes/jobs-printer-upload-reconcile.test.ts`
- `web/apps/server/src/routes/jobs-tenant.test.ts`

Documentation:

- `README.md`
- `docs/ARCHITECTURE.md`
- `web/DEPLOY.md`

## Commits

- `0997090` — `test: cover tenant isolation and atomic jobs`
- `5e1a3c1` — `test: expose database support status in health`
- `d011c58` — `fix: enforce tenant isolation and atomic job data`
- `5e4f99e` — `docs: mark Postgres repository experimental`
- `e463b3b` — `fix: detect native SQLite transactions`
- `1aa0dc1` — `test: create owned profile for auto-slice routes`
- `3cd7e72` — `test: cover remaining profile ownership entry points`
- `b3cec62` — `fix: guard all profile-scoped repository entries`

## Self-review

- Re-read the Task 2 brief and checked every requested interface and deployment
  outcome against the final diff.
- The first green run exposed the broken native-SQLite detector; runtime
  inspection showed `db.run/all/get` are the reliable synchronous capabilities,
  and the rollback test passed after correcting the detector.
- The first full suite exposed stale auto-slice fixtures that intentionally
  submitted a nonexistent profile. The fixtures now create and submit an owned
  profile.
- A broader repository pass found profile-scoped decisions/snapshots/history
  entry points beyond recompute/export; they now use the same ownership guard.

## Concerns

- Postgres remains experimental and has no native ACID repository mutation
  path. This task intentionally chose the documented explicit gate and
  production fail-closed behavior instead of claiming support or adding a smoke
  workflow that would bless the unsafe synchronous bridge.
- CodeRabbit CLI `0.7.3` was installed but reported
  `not_authenticated`. `coderabbit auth login --agent` reached
  `awaiting_browser_auth`, which cannot be completed non-interactively in this
  run, so no CodeRabbit result is available.

## Review blocker remediation

Status: DONE

Implementation HEAD before this report update:
`bf865ab342f7a5510bd18b65f0757c921987e31f`

### Verified findings and fixes

- Part-keyed mutation methods selected by globally unique part id without
  checking the row's tenant. A tenant that learned another tenant's id could
  update part fields, print progress, or assembled progress. `requirePart`
  now resolves through the tenant-filtered accessor before reads, writes, and
  destructive progress replacement. Progress reads/deletes also include
  `tenant_id`.
- The terminal cap was global. A busy tenant could evict another tenant's
  snapshots. Retention now groups terminal snapshots by tenant before applying
  the cap; active snapshots remain outside both the cap and TTL.
- Export jobs and `/exports/*` shared one filesystem namespace. Artifact roots,
  multipart uploads, queue/handoff operations, slicer handoff exports, URL-key
  generation, and download resolution now use an encoded tenant directory.
  Two tenants can produce the same relative filename without collision or
  cross-tenant download.
- Source creation now starts its best-effort sync with `request.tenantId`
  instead of `"default"`.
- Assistant recipe sequencing now passes its captured tenant explicitly to
  `waitForTerminal`.
- The MCP non-loopback setup error now explains both supported API-key sources:
  Settings and `PRINT_PARTNER_API_KEY`.
- Idempotent profile deletion remains a tenant-filtered no-op for stale ids.
  Optional-table and invalid-id guards again run before profile assertions so
  their intended benign behavior is preserved.
- Corrected indentation and whitespace in the Task 2 job, queue, and app
  registration changes.

### Red evidence

`npm run test -w @print-partner/server -- phase6 jobs-tenant exports-route`

- Exit 1 before remediation.
- Exactly 3 intended failures:
  - a cross-tenant `patchPart` call did not throw;
  - tenant A's artifact URL returned 404 because downloads did not resolve a
    tenant directory;
  - tenant A retained only its active job because tenant B consumed the global
    terminal cap.

The same regression tests also cover cross-tenant print/assembled progress
mutations, owner data remaining unchanged, same-name artifact isolation,
cross-tenant artifact path denial, and active jobs remaining outside retention.

### Green and final verification

Focused blocker suite:

`npm run test -w @print-partner/server -- phase6 jobs-tenant exports-route`

- Exit 0; 3 files and 10 tests passed.

Dependent route/auth/assistant suite:

`npm run test -w @print-partner/server -- slicer-handoff bambu-connect printer-send-queue assistant/tools http-routes`

- Exit 0; 7 files and 56 tests passed.
- The first run exposed a stale slicer-handoff mock that returned a shared-root
  path. The fixture now returns the tenant-root path passed to the exporter.

Complete server suite:

`npm run test -w @print-partner/server`

- Exit 0; 114 files passed, 1 skipped; 730 tests passed, 2 skipped.

Server typecheck:

`npm run typecheck -w @print-partner/server`

- Exit 0; no TypeScript diagnostics.

Lint:

`npm run lint`

- Exit 0; no ESLint diagnostics.

Diff hygiene:

`git diff --check 5915f9e..HEAD`

- Exit 0.

### Remediation files

- `.superpowers/sdd/task-2-report.md`
- `web/apps/server/src/app.ts`
- `web/apps/server/src/assistant/tools.ts`
- `web/apps/server/src/db/repository.ts`
- `web/apps/server/src/lib/secure-path.ts`
- `web/apps/server/src/mcp/http-routes.ts`
- `web/apps/server/src/phase6.test.ts`
- `web/apps/server/src/routes/bambu-connect.ts`
- `web/apps/server/src/routes/exports-route.test.ts`
- `web/apps/server/src/routes/exports.ts`
- `web/apps/server/src/routes/jobs-tenant.test.ts`
- `web/apps/server/src/routes/jobs.ts`
- `web/apps/server/src/routes/printer-send-queue.ts`
- `web/apps/server/src/routes/slicer-handoff.test.ts`
- `web/apps/server/src/routes/slicer-handoff.ts`
- `web/apps/server/src/routes/sources.ts`

### Remediation commits

- `dab7d28` — `test: expose remaining tenant isolation gaps`
- `c9ce7a9` — `fix: close remaining tenant isolation gaps`
- `8fdb39a` — `test: verify owner progress remains unchanged`
- `52f7e73` — `test: model tenant-scoped slicer artifacts`
- `f3594e6` — `fix: preserve default slicer tenant context`
- `bf865ab` — `style: normalize Task 2 formatting`

### Remaining concern

- Files generated before this remediation remain in the legacy shared
  `exports/` root and are intentionally not served by the tenant-scoped route.
  New export jobs regenerate them in the tenant directory.
