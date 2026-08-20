# Phase 3 Plan invalidation architecture

## Problem

Source revisions are immutable and a Source has an explicit active revision, but a successful Plan rebuild does not record what it read. The existing `build_stale` value only compares two timestamps. Source activation also changes `projects.local_path`, so Review and export can read new bytes while the Plan still describes an older build.

Phase 3 adds an accepted input identity and reasoned freshness. Source sync and naming edits remain read-only with respect to accepted parts and Checkoff. The durable Plan draft, diff, apply command, and Required-unit reconciliation remain Phase 7 work.

## Caller usage

The rebuild job keeps one repository call. Input capture, validation, publication, and acceptance stay inside it.

```ts
const result = repo.recomputeProfile(planId, { apply_manifest: true });

if (!result.merged) {
  // no_layers, no_stls, and would_wipe change no accepted state.
  return result;
}

return result; // includes accepted_input_set_id
```

Plan reads carry one structured freshness value.

```ts
const plan = repo.getProfile(planId);

switch (plan?.freshness.status) {
  case "current":
    renderCurrent();
    break;
  case "stale":
    renderReasons(plan.freshness.reasons);
    break;
  case "untracked":
    renderUntracked(plan.freshness.reasons);
    break;
}
```

The missing Source naming write becomes one validated operation.

```ts
const input = parseSourceNamingInput(request.body);
return repo.saveSourceNaming(sourceId, input);
```

## Public shape

```ts
type PlanStaleReason =
  | {
      kind: "source_revision_changed";
      source_id: number;
      source_name: string;
      accepted_revision_id: number;
      current_revision_id: number;
    }
  | {
      kind: "source_revision_unavailable";
      source_id: number;
      source_name: string;
      accepted_revision_id: number;
    }
  | {
      kind: "naming_rules_changed";
      source_id: number;
      source_name: string;
      accepted_digest: string;
      current_digest: string;
    }
  | { kind: "plan_configuration_changed" }
  | { kind: "plan_inputs_invalid" };

type PlanUntrackedReason =
  | { kind: "no_accepted_inputs" }
  | {
      kind: "source_revision_untracked";
      source_id: number;
      source_name: string;
    };

type PlanFreshness =
  | {
      status: "current";
      accepted_input_set_id: number;
      accepted_at: string;
    }
  | {
      status: "stale";
      accepted_input_set_id: number;
      accepted_at: string;
      reasons: readonly [PlanStaleReason, ...PlanStaleReason[]];
      untracked_sources: readonly PlanUntrackedReason[];
    }
  | {
      status: "untracked";
      accepted_input_set_id: number | null;
      accepted_at: string | null;
      reasons: readonly [PlanUntrackedReason, ...PlanUntrackedReason[]];
    };
```

`ProfileSummary` keeps `build_stale` for compatibility and adds `freshness`. New code reads the union. A definite revision, naming, or Plan configuration change is stale even when another Source is untracked. With no definite change, missing revision identity produces `untracked`, never `current`.

## Persistence

Schema version 18 adds `plan_accepted_input_sets`, one row per Plan:

```text
tenant_id
profile_id
input_set_id
accepted_at
```

The row is the accepted pointer. Publication time is not acceptance time. Moving the pointer from input A to B and back to the existing A row represents A to B to A without duplicating immutable input sets.

`plan_revision_input_sets` gains a format version. Version 2 input sets use one unified input row per Source. Each row records:

```text
source_id
source_layer
layer_order
tracking_kind = revision | untracked
source_revision_id and manifest_digest when tracked
effective_naming_digest
```

The input-set digest covers the canonical ordered rows, including Source identity, layer binding, tracking kind, revision identity, manifest digest, and effective naming digest. Version 1 rows remain readable history but cannot become accepted. The migration does not invent provenance for existing Plans.

The repository rejects two layers using the same Source before scanning. The version 2 table enforces one input row per input set and Source.

## Freshness

Freshness is derived when a Plan summary is read. The repository compares the accepted version 2 rows with current layer Sources, active revision pointers, and fully resolved naming profiles. It also preserves the existing Plan configuration timestamp check as the `plan_configuration_changed` reason.

Effective naming digests hash validated, fixed-key JSON. Array order stays significant because role, marker, folder-rule, and export precedence affect inference. Raw metadata and JSON property insertion order do not.

Source sync and naming saves do not fan out stale flags. Unrelated Plans remain current because their accepted inputs still compare equal.

## Rebuild boundary

`recomputeProfile` captures ordered layers, Source rows, active revision IDs, paths, import rules, and resolved naming profiles before scanning. The scanner uses only that capture. Immediately before accepted writes, the repository captures the inputs again and requires an exact match.

For SQLite, the existing native transaction encloses:

1. the final capture check;
2. live part and Checkoff reconciliation under the current behavior;
3. optional manifest application;
4. version 2 input-set publication;
5. accepted pointer movement;
6. accepted and recompute timestamps.

`no_layers`, `no_stls`, `would_wipe`, a changed capture, or a thrown write leaves the accepted pointer unchanged. SQLite rolls back all accepted data writes. Rebuilding the same inputs reuses the immutable input set and updates the accepted pointer time.

The synchronous PostgreSQL bridge does not provide a real database transaction. Phase 3 therefore refuses direct PostgreSQL rebuilds before writing parts, Checkoff, input sets, or the accepted pointer. Phase 7 must use a transaction-capable asynchronous repository or immutable Plan output before PostgreSQL rebuilds can be enabled safely.

## Accepted file resolution

Tracked accepted parts resolve through the accepted input row's `source_layer` and its Source revision `snapshot_locator`. They do not follow `projects.local_path`. Review, thumbnails, STL endpoints, 3MF export, and STL bundle export therefore keep reading the bytes accepted by the Plan after a Source advances.

Untracked Sources cannot make that guarantee. They remain visible as untracked and use their current local path until those import paths gain immutable revision identity.

Plans without an accepted pointer retain the current resolver as a migration fallback.

## Naming persistence

`PUT /sources/:id/naming` parses external JSON into one of two commands:

```ts
type SourceNamingInput =
  | { kind: "use_defaults" }
  | { kind: "override"; profile: StlNamingProfileDict };
```

The repository validates the full custom profile, preserves unrelated Source metadata, and stores only `metadata.naming`. Custom profiles are complete values so later global changes do not alter their meaning by accident.

Global and Source-specific equivalent saves do not create a stale reason. A real global change affects only Plans whose effective per-Source digest changes. A Source override affects only Plans that accepted that Source.

## UI policy

Automatic Plan rebuild is removed, including its setting and command-palette shortcuts. Rebuild remains an explicit action on Plan.

One freshness notice owns the copy and action policy:

- Plan shows changed Sources or naming rules and may offer explicit rebuild.
- Parts and Progress show the accepted state and link to Plan. They never start rebuild.
- `untracked` explains that revision freshness cannot yet be verified.
- Source sync and naming mutations refresh the shared Profiles query, which already supplies every surface.

This phase keeps the current direct rebuild behavior when the user explicitly invokes it on Plan. It does not call that operation a draft or claim that Checkoff reconciliation is complete.

## Module map

- `packages/contracts/src/index.ts` owns the wire union.
- `server/src/services/plan-freshness.ts` owns canonical digests and pure comparison.
- `server/src/db/repository.ts` owns capture, publication, acceptance, freshness reads, and Source naming persistence.
- `server/src/services/part-paths.ts` owns accepted snapshot resolution.
- `server/src/routes/settings.ts` validates Source naming requests.
- `web/src/components/PlanFreshnessNotice.tsx` owns status copy and Plan versus downstream actions.
- Plan keeps explicit rebuild. Parts and Progress link back to Plan.

## Synthesis decision

Candidate A is the base. Its unified tracked and untracked input row, explicit accepted pointer, mixed-state semantics, and compatibility field produced the stronger domain model. The synthesis takes Candidate B's safer UI policy, removes automatic rebuild entirely, captures every scan input, and distinguishes a missing active revision from a known newer revision.

The arena judge found one gap in both designs. Accepted STL resolution still followed the mutable Source path. The synthesis adds the accepted `source_layer` binding and routes tracked reads through the accepted revision snapshot.

The separate tracked and untracked tables from Candidate B were rejected because they expose one domain union as two storage protocols and do not enforce one tracked revision per Source. Removing `build_stale` and changing every recompute caller were also rejected as avoidable Phase 3 churn.

## Tradeoffs accepted

- We accept a read-time comparison in exchange for one source of truth and no invalidation fan-out.
- We accept an explicit untracked state in exchange for not fabricating revision history.
- We accept a guarded SQLite table rebuild in exchange for one constrained input representation.
- We accept that an explicit Plan rebuild still changes live parts in this phase. Phase 7 owns drafts and deliberate Checkoff reconciliation.
- We accept that PostgreSQL rebuilds remain unavailable until Phase 7 can commit accepted parts and provenance atomically.

## Verification

Repository tests cover affected and unrelated Plans, A to B to A, effective global and Source naming changes, legacy and non-Git inputs, duplicate Sources, failed and refused rebuilds, SQLite rollback, accepted snapshot resolution, and unchanged parts and Checkoff after Source activation.

Route tests cover both Plan response shapes and Source naming validation, persistence, metadata preservation, and tenant ownership. Web tests cover reason copy, removal of automatic rebuild, explicit Plan rebuild, and downstream links that cannot start rebuild.

## Implementation status

Implemented in schema version 18 with repository, route, accepted-file-resolution,
and UI policy tests. Full-workspace verification remains the final gate for this
phase.
