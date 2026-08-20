# Phase 1: define source revision identity

[Back to the overview](overview.md)

## Goal

Represent one complete source revision and record which revision a plan used.

## Changes

- Add the revision identity to shared source and plan data.
- Persist the revision consumed by a plan.
- Add focused serialization and repository tests.

Keep this phase to shared contracts, schema or repository metadata, and tests.
Do not change synchronization behavior yet.

## Data structures

`SourceRevision` has an immutable PrintPartner revision ID, Source ID, upstream
revision key, content-manifest digest, local snapshot locator, sync time, and
completeness state. Neither its identity nor its content may change after
creation. A failed or incomplete candidate remains an observation or sync
attempt; it never becomes a usable Source revision.

`PlanRevisionInput` records the immutable revision ID and content-manifest
digest consumed by one computed Plan. Repository boundaries reject incomplete
Source revisions as Plan inputs.

## Verification

Static checks run contract, repository, typecheck, and lint commands.

Runtime checks create two complete Source revisions, compute a Plan from the
first, and read back the exact revision identity and digest after the second
exists. They prove that revision identity and content cannot be updated, that
an incomplete candidate cannot become a Plan input, and that the existing Plan
stays pinned to its first complete revision.
