# Phase 1 source revision architecture

## Decision

Add a complete-only `source_revisions` ledger and append-only Plan revision
input sets. Keep the current mutable Source row, Build layers, recompute flow,
parts, and Checkoff state unchanged in this phase.

`profile_layers` remains draft Build configuration. It is not the record of
what the last computed Plan consumed because users can replace or remove a
layer before accepting another Plan revision.

## Storage

`source_revisions` stores:

- the PrintPartner revision ID and tenant;
- the reusable Source ID;
- the upstream revision key;
- the content-manifest SHA-256;
- an opaque snapshot locator;
- the original sync time; and
- a completeness value constrained to `complete`.

The unique identity is tenant, Source, and upstream revision key. Registering
the same key, digest, and locator again returns the existing revision.
Registering the same key with different content or a different locator is a
conflict. Manual imports must therefore derive their upstream key from the
canonical manifest and identity metadata.

`plan_revision_input_sets` stores one immutable grouping for a computed Plan:

- tenant and Plan ID;
- a digest of the canonical ordered input list;
- expected input count;
- recorded time; and
- nullable publication time.

`plan_revision_inputs` stores the Source revision ID and a copied manifest
digest. The repository verifies that the copied digest equals the immutable
revision digest.

## Publication boundary

The PostgreSQL compatibility bridge does not provide a database transaction
for the synchronous repository API. Publishing a Plan input set therefore uses
an explicit visibility boundary:

1. Validate the Plan, every revision, tenant ownership, uniqueness, and every
   copied digest.
2. Canonicalize the inputs and create or reuse an unpublished set keyed by its
   digest.
3. Insert its input rows idempotently.
4. Re-read the rows and require the exact expected count and canonical content.
5. Set `published_at` once.

Readers ignore unpublished sets. A stopped or retried writer can leave a draft
but cannot expose a partial dependency record.

## Invariants

- An incomplete download or failed validation is a sync observation, not a
  Source revision. Phase 2 will model those attempts separately.
- Revision identity and content have no repository update or delete operation.
- A Source with revision history cannot be deleted. Source archival and byte
  retention policy remain later work.
- Existing Builds stay explicitly unpinned. The current mutable directories
  are not backfilled as complete revisions because their completeness was
  never proven.
- Deleting a Build may cascade its input sets during this phase. Durable
  accepted Plan revision retention belongs to the workflow phase.

## Repository surface

```ts
recordSourceRevision(input): SourceRevision
getSourceRevision(id): SourceRevision | null
listSourceRevisions(sourceId): SourceRevision[]
publishPlanRevisionInputs(planId, inputs): PlanRevisionInputSet
getLatestPlanRevisionInputSet(planId): PlanRevisionInputSet | null
listPlanRevisionInputSets(planId): PlanRevisionInputSet[]
```

The public contracts expose readonly `SourceRevision`, `PlanRevisionInput`, and
`PlanRevisionInputSet` values. Completeness is the literal `"complete"`.

## Deferred work

- creating revisions during Git, archive, local, or marketplace sync;
- revision-scoped file manifests and immutable snapshot directories;
- moving selection and naming overrides onto Build Sources;
- scanning revision roots during recompute;
- Source update invalidation and review;
- accepted Plan revision persistence and rollback;
- Checkoff, Plate, 3MF, and export provenance; and
- Source archival, garbage collection, and retention policy.

These are deliberately deferred so Phase 1 establishes the identity and
persistence boundary without claiming that the current sync flow is atomic.
