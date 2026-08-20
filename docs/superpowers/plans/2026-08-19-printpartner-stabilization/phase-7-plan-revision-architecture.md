# Phase 7 Plan revision architecture

## Boundary

An accepted Plan revision is immutable. A saved Plan draft is a complete
proposed snapshot based on one accepted revision and version. The current
`parts` and `print_progress` tables remain compatibility projections until
their readers migrate. Only **Apply plan changes** may install an accepted
pointer or change Checkoff requirements. A legacy compatibility write may
clear the pointer to avoid claiming that an older revision is current.

The supported apply path is SQLite. PostgreSQL remains fail-closed because the
current synchronous bridge cannot bind several statements to one database
transaction. Phase 7 does not add a second, misleading serialization layer.

## Accepted revisions

`build_profiles` owns the compare-and-swap fields:

- `accepted_plan_revision_id`, nullable for an unbackfilled, empty, or
  compatibility-dirty Build; and
- `accepted_plan_version`, starting at zero.

`plan_revisions` records the immutable revision header:

- tenant, Build, revision number, and parent revision;
- accepted Source input set when provenance is tracked;
- `tracked` or `legacy` provenance;
- canonical digest format and snapshot digest; and
- actor and acceptance time.

`plan_revision_parts` records the immutable accepted part values. It stores
inferred role and quantity separately from nullable overrides. Effective role
is derived. The backfill also preserves the current effective quantity because
older imports could store a value that differs from the inferred and override
fields. New draft applies must derive and validate this value. It also stores
inclusion, Source layer, path, filament display fields, requirement metadata,
and an optional artifact digest. A missing artifact digest is explicit legacy
or untracked evidence, not a fabricated identity.

The first implementation slice backfills one revision from each existing
SQLite Build and proves field parity. It does not change `parts`,
`print_progress`, Checkoff settings, exports, or Printer links.

Until draft callers replace compatibility writes, a write to `parts` or
`profile_layers` clears the accepted pointer without resetting its monotonic
version or deleting history. This explicit compatibility-dirty state prevents
new code from treating an older snapshot as current. The draft cutover creates
one fresh accepted baseline before it enables draft reads.

## Drafts

Later Phase 7 slices add:

```ts
type PlanDraftState = "open" | "abandoned" | "consumed";

type ApplyPlanChanges = {
  buildId: number;
  draftId: string;
  expectedBaseRevisionId: number | null;
  expectedPlanVersion: number;
  idempotencyKey: string;
  actorId: string;
};

type ApplyPlanResult = {
  buildId: number;
  revisionId: number;
  planVersion: number;
  appliedAt: string;
};
```

`plan_drafts` stores the base revision, base Plan version, canonical digest,
digest format, state, actor, timestamps, and consumed revision. Draft Source
and part rows are normalized child tables. Source picks, selection changes,
manifest decisions, and quantity overrides write those rows without changing
accepted state.

Abandon moves an open draft to `abandoned`. Resume returns it to `open` only
while its base revision and Plan version remain current. Otherwise the user
must rebase, which writes a new open draft and preserves the abandoned draft
as history. Only an open draft may apply. A consumed draft is terminal.

`plan_apply_requests` is keyed by tenant, actor, Build, and idempotency key. Its
payload hash covers a versioned canonical serialization of the Build, draft
ID, draft digest, base revision, and expected version. It stores the complete
response JSON. A matching retry returns that response. Reusing a key with a
different payload returns a conflict.

## Apply transaction

One native SQLite transaction performs these operations:

1. Claim or resolve the idempotency key.
2. Require an open draft and verify its stored canonical digest.
3. Verify the draft base revision and expected Plan version. A first apply for
   an empty Build must compare against `(NULL, 0)`.
4. Clear the accepted pointer without changing its version. This write is
   temporary and remains inside the transaction.
5. Publish the immutable revision, parts, and accepted Source input rows.
6. Replace the accepted `profile_layers` projection and its pinned Source
   revisions.
7. Reconcile Required-unit tokens and their completion state.
8. Refresh `parts` and `print_progress` compatibility projections.
9. Compare and swap `(NULL, expected version)` to the new revision and the
   next version; require one row. This final pointer write follows every
   projection invalidation trigger.
10. Consume the draft and persist the exact idempotency response.
11. Commit.

Any failed write rolls back every step. A stale apply leaves its draft open.
Rebase recomputes the draft from the new accepted revision and presents a new
diff. It never applies automatically.

## Required-unit identity

A Required unit has a durable opaque token. Neither path, part key, content
digest, revision-part ID, nor unit index is its identity.

`required_units` owns the token and Build. `plan_revision_required_units` maps
each accepted revision part and unit index to that token.
`required_unit_progress` records completion and assembly against the token.
Printer jobs and Checkoff links capture the accepted Plan revision,
revision-part ID, and token that existed when work was prepared.

Reconciliation uses artifact digest, path, role, and prior revision as
evidence:

- An exact-content rename retains tokens and completion.
- A quantity increase retains existing tokens and creates new tokens.
- A quantity decrease retains completed tokens first, then the oldest missing
  tokens. Surplus tokens remain history.
- A removed part retains historical tokens but has no mapping in the new
  revision.
- A content or filament-role change requires an explicit draft decision about
  whether prior completion still satisfies the requirement.

The artifact digest comes from streamed STL bytes for new tracked drafts.
Legacy or untracked rows may have no digest and therefore cannot claim exact
content reconciliation.

## Module shape

```ts
backfillAcceptedPlanRevisions(db): BackfillResult
readAcceptedPlanRevision(buildId): AcceptedPlanRevision | null
recomputePlanDraft(buildId, actorId): PlanDraft
applyManifestToPlanDraft(draftId): PlanDraft
diffPlanDraft(draftId): PlanDraftDiff
rebasePlanDraft(draftId, actorId): PlanDraft
applyPlanChanges(command: ApplyPlanChanges): ApplyPlanResult
```

Contracts own the wire values. Repository code owns tenant-filtered
persistence. Pure services own canonical serialization, diffing, and
Required-unit reconciliation. Routes parse actor, expected version, and
idempotency values at the boundary.

## Implementation slices

1. Add accepted revision tables and Build pointer fields. Backfill SQLite and
   add a parity reader. Preserve every existing behavior and byte of Checkoff
   state.
2. Add saved drafts, draft recompute, draft edits, diff, abandon/resume, and
   rebase. Accepted reads and Checkoff remain unchanged.
3. Add Required-unit tokens and explicit reconciliation decisions.
4. Add the atomic, idempotent apply command and refresh compatibility
   projections inside its transaction.
5. Move Plan callers to drafts, migrate accepted readers, then delete direct
   accepted-part and layer mutation paths.

## Verification

The foundation slice covers populated and empty v18 databases, tracked and
legacy provenance, field parity, tenant isolation, idempotent reopen, foreign
keys, injected rollback, and unchanged `parts`, `print_progress`, and
`app_settings`.

The completed phase additionally covers saved draft resume, no Checkoff change
before apply, abandoned-draft rejection, stale apply conflict, first apply from
`(NULL, 0)`, two racing applies with one winner, an accepted pointer that
survives projection refresh, exact retry, changed-payload key reuse, injected
apply rollback, rebase diff, and every Required-unit reconciliation rule.
