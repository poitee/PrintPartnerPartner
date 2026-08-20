# Phase 6: give server state one frontend owner

[Back to the overview](overview.md)

## Goal

Remove competing source and plan snapshots from pages, panels, context, and the
workflow indicator.

## Changes

- Define query-backed feature modules for sources and plan revisions.
- Route mutations through one invalidation policy.
- Migrate one page or panel at a time.
- Delete direct-fetch and revision-counter paths after their callers migrate.

Do not split large pages for visual neatness in this phase.

## Data structures

`SourceQueries` and `PlanQueries` own query keys, parsed results, mutations, and
invalidation rules.

## Verification

Static checks run focused hook and component tests, web typecheck, and lint
after each migrated caller.

Runtime checks keep a page, a nested panel, and the workflow indicator visible
during a source mutation. All three must show the same result without a manual
reload.
