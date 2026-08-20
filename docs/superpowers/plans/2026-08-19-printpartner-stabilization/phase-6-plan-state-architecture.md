# Plan browser-state architecture

## Identity and cache state

`freshness.accepted_input_set_id` is the current persisted identity of the
Source inputs accepted by recompute. Phase 7 will add the durable accepted
parts Plan revision. Neither identity is a browser refetch counter.

TanStack Query owns loaded Plan projections. Query invalidation means a
projection should be read again. It does not create or imply a domain revision.
`dataUpdatedAt` may support diagnostics, but it is not concurrency control or
accepted Plan identity.

## Plan layers

`queries/planLayers.ts` owns `queryKeys.planLayers(profileId)` and these writes:

- set the base Source;
- add an addon Source;
- replace a layer Source; and
- remove a layer.

Base, add, and replace responses contain the complete authoritative layer
list, so the mutation publishes that list immediately. Delete returns no list,
so it invalidates the layer query. Every layer write also invalidates the Plan
review and Plan summaries because their attached-Source and freshness
projections may have changed.

`BuildPage` and `BuildSourcesPanel` subscribe to the same profile-scoped layer
query. Neither accepts a copied layer list or a setter from the other. Direct
snapshot restore invalidates the same Plan-structure boundary.

## Review projections

`PlanWorkspaceContext` owns the normal included-parts review query and part
mutation commands. Its `invalidate` command refetches that query without
incrementing local state.

The Parts review sheet requests its own `includeExcluded: true` projection only
when the selected filter needs excluded parts. It must not change the normal
workspace query for every other page.

## Counter removal

Remove `revision`, `loadedRevision`, `bumpPlanRevision`,
`usePlanRevisionBump`, and revision comparison effects. Profile-scoped query
keys already switch reads when the selected Plan changes. Completed jobs and
successful mutations invalidate the projections they change.

Callers that used the counter as an unrelated refresh signal must move to the
query that owns that data. In particular, role filament consumers use
`queryKeys.roleFilaments(profileId)`, and recipe snapshot restore invalidates
Plan structure explicitly.

## Verification

- A complete layer mutation updates every subscriber for one Plan without
  changing another Plan's cache.
- A delete invalidates only the selected Plan's layer query.
- Failed writes do not replace cached layers.
- Included and excluded review queries remain distinct.
- Selecting a Plan changes the query key without a refetch counter.
- No component reads `revision` or `loadedRevision` from the workspace.
- The repository quality gate and a real browser Plan check pass.
