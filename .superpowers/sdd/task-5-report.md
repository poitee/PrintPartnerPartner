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

## Review remediation

Status: complete on `cursor/full-codebase-audit-2c41`.

Implementation HEAD before this report:
`fc277835a2103eb7a54c8489666614dcf4e8f73c`.

### Fixed Important, Minor, and adjacent findings

- Strengthened the persisted export orchestration fixture to use three copies
  across two explicit plates. The test now proves that persisted plate
  boundaries override fallback packing and that the persisted 7 mm spacing,
  rather than the 4 mm fallback, produces the second-copy x-coordinate.
- Malformed print-plan PUT bodies now return `400`, log a structured warning,
  and leave the persisted plan unchanged. GET now returns
  `grouping_strategy`. Loading persisted plans salvages each independently
  valid field while logging and defaulting malformed fields instead of
  discarding the entire plan.
- Backup creation now snapshots SQLite with better-sqlite3's backup API,
  which incorporates committed WAL data into one consistent database file.
  Critical directories stream directly into the compressed archive; they are
  no longer copied into a duplicate staging tree.
- Backup publication writes a unique sibling temporary archive, syncs it, and
  atomically renames it into place. Snapshot/archive failures clean temporary
  state and cannot truncate an existing published backup.
- Validation parses every archive entry but extracts only metadata, database,
  and optional WAL state. Validation and restore enforce defaults of 100,000
  entries, 20 GiB total decompressed bytes, 8 GiB per entry, 64 KiB metadata,
  and a 200:1 decompression ratio.
- Tar callbacks no longer throw from `filter`; they record the first invalid
  entry, reject extraction for it, allow the parser to settle, and then reject
  through the awaited promise.
- Validation opens the isolated database and requires
  `PRAGMA integrity_check` to return `ok`; a valid SQLite header is no longer
  sufficient.
- Backup multipart filenames are normalized and sanitized for both POSIX and
  Windows separators. Each request receives a unique contained upload
  directory, and uploads stream to a create-only file instead of buffering the
  complete archive in memory.
- Backup download/delete lookup now rejects backslashes and unsafe stored
  names and uses canonical containment rather than string-prefix checks.
- Realpath behavior is documented in both secure-path modules: in-root
  symlinks resolve to a canonical path, escaping symlinks are rejected, and
  canonical temporary paths can differ on macOS. Tests compare canonical
  paths and are portable across `/tmp` aliases.
- Domain production builds now use a dedicated build tsconfig, clean stale
  output, exclude tests/specs, and keep composite build-info inside `dist` so
  every clean build re-emits declarations. Server builds continue to exclude
  tests/specs.

### TDD evidence for review fixes

The review regression tests were committed and pushed before production
changes (`2a37d72`).

Initial focused server run:

```text
Test Files 5 failed | 1 passed
Tests 14 failed | 8 passed
```

Failures matched the missing SQLite snapshot API, non-atomic backup behavior,
missing decompressed limits/integrity check, malformed HTTP `500` responses,
whole-plan fallback without warnings, missing grouping strategy, and absent
multipart path sanitizer. The expanded persisted multi-plate/spacing export
test passed against the existing orchestration.

The pre-fix domain build inspection exited non-zero because test/spec outputs
were present. A later clean domain-then-server build exposed stale composite
build information preventing domain re-emission; moving production build-info
under cleaned `dist` fixed the repeat-build failure.

Final focused review suite:

```text
9 files passed
40 tests passed
```

### Final verification after all review fixes

- Domain tests: 18 files, 127 tests passed.
- Server tests: 120 files passed, 1 skipped; 761 tests passed, 2 skipped.
- Domain and server typechecks: passed with no diagnostics.
- Workspace lint: passed with no ESLint diagnostics.
- Domain and server production builds: passed.
- Domain `dist`: 108 generated files including `dist/index.js`; zero
  test/spec modules, declarations, or maps.
- Server `dist`: 760 generated files including `dist/index.js`; zero
  test/spec modules, declarations, or maps.
- `git diff --check`: passed.

### Review-fix commits

- `2a37d72` — `test: expose Task 5 review blockers`
- `0a74b56` — `fix: reject malformed print-plan requests`
- `5c26fd8` — `fix: snapshot SQLite through backup API`
- `9ad4237` — `fix: bound and atomically publish backups`
- `59dab5d` — `fix: narrow archive callback inputs`
- `588400c` — `fix: confine streamed backup uploads`
- `bd6462d` — `build: exclude domain tests from production output`
- `37083da` — `fix: regenerate clean domain build output`
- `fc27783` — `refactor: stream backup archives from source data`

### Remaining concerns

- SQLite is transactionally snapshotted, but critical filesystem directories
  are streamed from the live data tree and are not a cross-filesystem
  point-in-time snapshot. Concurrent changes can make those non-database files
  represent slightly different instants; an I/O failure aborts publication.
- Restore retains its pre-restore safety copy and validates before mutation,
  but replacing SQLite plus several directories remains a recoverable
  multi-step operation rather than one filesystem-wide atomic transaction.
- Backups exceeding the documented archive limits are intentionally rejected.
  Installations with legitimately larger data trees must raise the limits in a
  future configurable policy rather than bypassing validation.
