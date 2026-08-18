# Task 5 report: Core integrity and coverage gaps

## Status

Complete on `cursor/full-codebase-audit-2c41`.

Implementation HEAD before this report:
`1e21538daacb7773eaafabd8fb220dba017712f7`.

## Verified findings and implementation

- Added strict, backward-compatible kit print-plan decoding. Missing legacy
  fields still receive defaults, while explicitly malformed printer ids,
  assignments, grouping strategies, layouts, printer plans, and copy refs fail
  with field-specific `Invalid kit print plan` errors.
- Added full nested print-plan round-trip coverage for both persisted layout
  structure and height-band grouping.
- Changed domain and server file confinement checks from lexical prefix checks
  to real-path containment, blocking files reached through symlinks outside the
  configured root.
- Covered regular files, traversal, sibling-prefix paths, missing files,
  directories, and escaping symlinks.
- Removed the domain plate packer's `console.warn` side effect. Height variance
  remains available through the existing structured warnings result.
- Rejected incomplete ASCII triangles and non-finite ASCII/binary STL
  coordinates before they can poison mesh bounds or placement calculations.
  Signed/exponential ASCII coordinates and binary files whose header begins
  with `solid` remain supported.
- Added real export-3MF orchestration tests using persisted fleet/print-plan
  settings and actual STL-to-3MF output. Coverage verifies explicit plate
  layouts, missing-only copy selection, per-job printer overrides, and the
  no-printer failure.
- Backup creation now includes the existing critical data directories while
  skipping symbolic links.
- Backup validation now parses every archive entry, rejects absolute,
  traversal, backslash, duplicate, unexpected, and special-file entries,
  requires metadata plus the SQLite database, validates metadata fields and the
  SQLite header, and uses unique staging directories.
- Restore now validates and safely extracts the complete archive before
  closing SQLite or changing live files. It removes stale WAL/SHM state before
  applying the backup's matching WAL and reconnects after success or a
  post-close failure.
- Added backup round-trip, corrupt gzip, missing database, corrupt SQLite, and
  traversal-before-mutation coverage.
- Closed the relevant Task 2 legacy-export follow-up: queued artifact migration
  no longer rewrites a legacy path to a symlink that escapes the tenant export
  root. Existing collision behavior remains intentionally conservative.
- Added `apps/server/tsconfig.build.json` and a clean production build command.
  Normal `tsconfig.json` typechecking still includes tests, while production
  output excludes test/spec modules and removes stale output first.

## TDD evidence

Tests were committed and pushed before production changes.

Initial focused domain run:

```text
npm run test -w @print-partner/domain -- kit-print-plan secure-path stl-geometry plate-packer
Test Files 4 failed | 1 passed
Tests 14 failed | 35 passed
```

The failures matched permissive plan coercion, symlink escape, incomplete and
non-finite STL acceptance, and the plate-packer console call.

Initial focused server run:

```text
npm run test -w @print-partner/server -- export-3mf-job backup-restore secure-path printer-send-queue-store
Test Files 3 failed | 1 passed
Tests 7 failed | 17 passed
```

The real export job tests passed against existing orchestration. The intended
failures exposed omitted backup directories, metadata-only validation,
mutation before missing-database rejection, traversal acceptance, server
symlink escapes, and unsafe queued-path migration.

The first green server run exposed one `tar` integration issue: throwing from
an `onentry` event escaped the archive promise and stalled parsing. Validation
now records the entry error, lets parsing settle, and rejects through the
normal promise path.

Final focused verification:

```text
Domain: 5 files, 49 tests passed
Server: 4 files, 24 tests passed
```

## Full verification

- Domain tests: 18 files, 127 tests passed.
- Server tests: 116 files passed, 1 skipped; 748 tests passed, 2 skipped.
- Domain typecheck: passed with no diagnostics.
- Server typecheck, including test modules: passed with no diagnostics.
- Workspace lint: passed with no ESLint diagnostics.
- Domain production build: passed.
- Server production build: passed.
- Server `dist`: 760 generated files, including `dist/index.js`; zero
  `*.test.*` or `*.spec.*` modules/maps/declarations.
- `git diff --check`: passed.

## Commits

- `7397aee` — `test: expose core integrity coverage gaps`
- `f53c643` — `fix: validate domain print and mesh integrity`
- `770dab6` — `fix: validate backups before restoring data`
- `3a9d757` — `build: exclude server tests from production output`
- `1e21538` — `fix: reject invalid tar entries without stalling`

## Concerns

- Restore is guarded by complete pre-mutation validation and retains a
  `.pre-restore-backup`, but replacing several live directories plus SQLite is
  still a multi-step filesystem operation rather than one atomic transaction.
- Legacy export files that collide with existing `tenant-default` destinations
  remain in the legacy root for manual reconciliation, preserving Task 2's
  no-overwrite policy.
- Critical directory backups can be substantially larger than the previous
  database-only archive. Symbolic links are deliberately omitted rather than
  followed or restored.
