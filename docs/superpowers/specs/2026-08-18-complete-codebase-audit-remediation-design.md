# Complete Codebase Audit Remediation Design

## Goal

Resolve every verified codebase, UI, workflow, functionality, CI, documentation,
and repository-hygiene issue found in the August 18 audit. Each finding must end
in one of three states: fixed with regression coverage, documented as an
intentional product constraint, or disproved by a focused test.

## Security and tenancy

Production and non-loopback deployments are secure by default. Loopback
development remains usable without configuration.

- Remove spoofable browser-header authentication bypasses from `/api/v1`.
- Make settings-managed API keys functional, one-way protected, expirable, and
  revocable.
- Protect destructive and administrative routes with the same explicit admin
  authentication policy.
- Disable development login in production unless an explicit opt-in is set.
- Mark production session cookies `Secure`.
- Redact webhook secrets from list responses.
- Require a real configured credential for protected metrics access.
- Enforce tenant ownership before profile-scoped recompute/export work and
  tenant-scope in-memory job reads/subscriptions.
- Bound completed in-process jobs with retention and pruning.

The existing flat-route self-host API remains available without credentials
only on loopback. Non-loopback production deployments must configure Basic Auth,
multi-user auth, or an API key.

## UI and workflow

All desk-loop pages expose a consistent engine state. Offline, loading, error,
and empty states are distinct and actionable.

- Library, Plan, Plans, Progress, Export, and Settings must not show usable
  mutation controls while the engine is offline.
- Progress optimistic mutation failures must be announced with a toast.
- Slicer handoff must use the same effective enabled-printer set as 3MF export.
- The application must have one page-level `h1`, a skip-to-content link,
  accessible search names, live loading regions, and keyboard-submit login.
- SPA navigation must not force full document reloads.
- Auxiliary Progress fetch failures must be visible instead of silently
  appearing empty.
- Mobile layouts must retain access to actions without relying on hidden,
  unexplained horizontal overflow.

UI changes preserve the existing industrial desk-loop visual language rather
than introducing a new theme.

## Correctness and data integrity

- Recompute mutations must be atomic on SQLite. Postgres limitations must be
  covered by a live smoke test and documented until the repository is migrated
  to an async-native transaction architecture.
- Core print-plan serialization, export-job orchestration, backup/restore, and
  secure path behavior gain focused coverage.
- Domain code returns structured warnings rather than writing directly to
  stderr.
- API errors use the existing problem-response shape where practical.

## CI, release, and repository hygiene

- Web CI runs lint, typecheck, tests, and production build.
- Deploy-file changes trigger Docker validation.
- Release publishing depends on the full quality gate.
- Manifest CI validates YAML against the correct v1/v2 JSON Schema on pull
  requests and pushes to `main`.
- Embedded manifest copies are checked for drift.
- Dependency automation and a high-severity audit gate are enabled.
- Node 22 is pinned and package metadata reflects it.
- Build TypeScript excludes test emission.
- Documentation links, test-count claims, setup commands, manifest versions,
  SaaS/Postgres status, and removed AI configuration comments are corrected.
- Merged/stale Cursor branches are cleaned up after the final PR merges.

## Testing

Behavior changes follow red-green-refactor. The final gate is:

1. `npm run lint`
2. `npm run typecheck`
3. `npm test`
4. `npm run build`
5. Manifest schema/drift validation
6. Dockerfile build and compose configuration validation when Docker is
   available
7. Manual browser walkthrough of setup/offline states, enabled-printer handoff,
   Progress failure feedback, keyboard navigation, and a narrow viewport

The final branch receives CodeRabbit review. All critical and warning findings
are fixed before the PR is merged to `main`; no audit PR remains open.
