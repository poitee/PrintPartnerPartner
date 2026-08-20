# Phase 7: encode the accepted workflow

[Back to the overview](overview.md)

## Goal

Turn the Phase 0 decision into one domain model for navigation, readiness,
status, and completion.

## Changes

- Replace the current mixed stage flags with the accepted states and
  transitions.
- Add one **Apply plan changes** command that compares a Plan draft with the
  accepted Plan and creates a Plan revision.
- Require that command to carry the draft's base Plan revision or expected
  version plus an idempotency key scoped to the authenticated actor and Build.
  Persist a payload hash covering the draft and base revision; reject key reuse
  with a different hash. In one transaction, conditionally advance the accepted
  Plan only where its current version equals the expected version, require
  exactly one affected row, create the accepted revision, update every affected
  `BuildSource.pinnedRevisionId`, consume the draft, and persist the idempotency
  result. Zero affected rows is a conflict. A matching retry returns only its
  original result. Offer an explicit rebase that recomputes and presents new
  differences after a conflict.
- Define explicit commands for recompute preview and manifest application.
- Represent an inferred role and quantity separately from a manual quantity
  override.
- Make page labels and action names use the accepted vocabulary.
- Remove obsolete stage assumptions after callers migrate.

## Data structures

The exact types come from Phase 0. A Plan draft remains separate from an
accepted Plan revision. If the production-loop model wins, use a Build planning
state and a separate production-run state rather than one five-stage boolean
list.

The concrete storage, command, transaction, and Required-unit boundaries are
defined in [the Plan revision architecture](phase-7-plan-revision-architecture.md).

## Verification

Static checks run domain transition tests, workflow component tests, typecheck,
and lint.

Runtime checks exercise every allowed transition and one rejected transition
through the real UI. Edit a draft, abandon the page, return to the saved draft,
review its differences, and apply it. Checkoff must not change before the apply
command. Create a second accepted revision before applying an older draft and
prove the stale apply is rejected without overwriting either revision. Race two
apply requests with the same expected revision and prove exactly one commits.
Retry the winning request with the same idempotency key and prove it does not
create another revision; reuse the key with a changed draft and prove it is
rejected. Inject a failure between Source-pin and Plan writes and prove the
transaction leaves both unchanged. Each action name must produce the same
behavior wherever it appears.
