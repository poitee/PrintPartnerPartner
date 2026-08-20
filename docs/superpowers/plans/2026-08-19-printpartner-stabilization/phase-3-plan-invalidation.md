# Phase 3: invalidate plans after source changes

[Back to the overview](overview.md)

## Goal

Tell users when a plan no longer represents its source revisions.

## Delivered changes

- Compare a plan's recorded inputs with current source revisions.
- Record the accepted Source revision, layer binding, naming digest, and tracking state for every Source used by a successful Plan rebuild.
- Resolve accepted STL files from immutable Source snapshots instead of the Source's latest path.
- Report affected Plans as stale after Source, naming, or Plan configuration changes.
- Persist global and source-specific STL naming changes through tested routes.
- Keep unrelated Plans current.
- Remove automatic rebuilds. Plan owns the explicit rebuild action; Parts and Progress link back to Plan.
- Preserve an honest untracked state for Plans or Sources without revision identity.

## Data structures

`PlanFreshness` is `current`, `stale`, or `untracked`. Stale state carries a
reason discriminator for Source revision, naming-rule, or Plan configuration
changes. The existing Plan response keeps `build_stale` for compatibility and
adds the structured freshness value.

## Verification

Focused tests cover dependent and unrelated Plans, A to B to A revision
changes, global and Source naming changes, untracked Sources, refused rebuilds,
accepted snapshot resolution, Source naming validation, and the Plan versus
downstream action policy. The complete quality suite remains the release gate.

Draft generation, diff review, explicit apply, and durable Checkoff
reconciliation remain Phase 7 work. Phase 3 keeps the existing direct rebuild
after the user explicitly invokes it from Plan.
