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

Phase 7 slice 2 starts with persisted recompute snapshots and deterministic
diffs. Unit 2b adds bounded Part decisions. Unit 2c1 adds saved draft lifecycle.
Later Phase 7 slices add Required-unit reconciliation and Apply:

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

The draft tenant, Build, base revision, and base Plan version are immutable
after insert in both databases. Later lifecycle commands may change only
lifecycle metadata such as state and terminal timestamps. Ownership checks
still validate every allowed header or child update.

Schema v20 implements the first unit with `plan_drafts`,
`plan_draft_inputs`, and `plan_draft_parts`. It writes only `open` drafts but
keeps the complete `open | abandoned | consumed` state discriminant for later
commands. A Build may have several open drafts. Callers list them in creation
order by `created_at`, then draft ID, and read one by ID. There is no singular
`readOpenDraft` rule.

Schema v21 adds `lifecycle_version` to distinguish repeated state cycles. The
single `transitionPlanDraft` command accepts `abandon` or `resume` with an
expected generation. It maps only `open -> abandoned` and
`abandoned -> open`; `consumed` remains terminal. A state change increments the
generation exactly once, while a same-state write cannot change it. Both
databases enforce that rule and cap the portable integer at 2,147,483,647. A
new transition accepts expected generations only through 2,147,483,646 so its
increment remains in range. Lifecycle state and generation are excluded from
`plan-draft-v1`, which continues to represent planning content.

SQLite transitions use one immediate transaction and verify the complete
snapshot digest before policy checks. A matching target state at generation
`expected + 1` is an exact retry and returns unchanged before freshness checks.
Other generation mismatches conflict. Resume requires a clean, current accepted
base; abandon remains available when the base is stale or compatibility-dirty.
The state and generation update is one scoped compare-and-swap followed by a
verified read. PostgreSQL returns `transaction_unavailable` until its repository
has a real transaction path. Routes, UI, audit timestamps, event history, and
Apply remain deferred.

Schema v22 adds immutable rebase lineage directly to `plan_drafts`. A rebase
origin records the abandoned source draft ID, its lifecycle generation, and
its verified snapshot digest. All three values are present or all are null.
Both databases require the source and result to share a tenant and Build,
require the source to be abandoned at the recorded generation and digest, and
allow only one successor for one source generation. Lineage and lifecycle
metadata remain outside `plan-draft-v1`.

`rebasePlanDraft` extracts only inclusion and quantity override deltas. A Part
without an accepted predecessor uses the known recompute baseline of included
and no quantity override. Matching considers only decision-bearing Parts and
uses unique accepted projection identity first, then unique Source and Part
key identity, then unique tracked Source and artifact digest identity when the
exact key disappeared. Field-level three-way replay accepts unchanged or
convergent current values and reports deterministic conflicts for divergent
decisions, ambiguous identity, missing targets, or target collisions.

Retry lookup by actor, Build, and key runs before freshness work. A matching
rebase origin returns the stored result. A key owned by recompute or another
origin returns `idempotency_conflict`. A second actor or key for the same source
generation returns the one stored successor. A same-base request returns
`base_unchanged` only after confirmation inside an immediate transaction.
Preparation loads the immutable revision named by the captured base rather
than following the mutable accepted pointer. SQLite prepares the fresh scan
outside one immediate write transaction, then repeats retry lookup, verifies
source integrity and current accepted and input state, inserts the complete
open result, and verifies it before commit. PostgreSQL remains fail closed
without a native transaction.
Rebase does not add edit history, conflict drafts, routes, UI, Apply, or
Required-unit reconciliation.

Draft recompute accepts `(NULL, 0)` only when the Build also has no live
compatibility Parts. A null pointer with a nonzero version, or a null pointer
with live Parts, returns `accepted_baseline_required`. Recompute reads matched
planning fields from `plan_revision_parts`, never from `parts`. It rechecks
the base pair and captured input fingerprint inside the same native SQLite
transaction that inserts the header and every child row.

The `plan-draft-v1` digest covers the base pair, canonical inputs, every part
value, duplicate rows, and each part's deterministic accepted predecessor.
Database row IDs, draft state, actor, and timestamps do not affect the digest.
The v20 creation key is unique by tenant, actor, and Build. Retry lookup runs
before baseline capture and scanning, then returns the stored snapshot. If two
creators pass that lookup concurrently, each repeats it as the first statement
inside the immediate SQLite transaction. The second creator waits for the
winner to commit, then returns the complete row with the same tenant, actor,
Build, and key before it checks the now newer base or Source state. The unique
index remains the database enforcement for that identity.

The transaction returns `base_changed` when the accepted pointer or Plan
version moved and `inputs_changed` when the captured input fingerprint moved.
Both are normal optimistic concurrency results and write no draft rows.

PostgreSQL has matching v20 tables and ownership checks, but draft mutations
return `transaction_unavailable` until its repository path has a real database
transaction. Recompute measures each tracked revision STL with a fixed 64 KiB
buffer and stores its SHA-256 in `artifact_digest`. It measures the current
scanned path for every draft and never copies prior evidence. Untracked Source
Parts keep a null digest and cannot claim exact-content identity.

Unit 2b adds one `editPlanDraftParts` command. Its decision discriminant is
either grouped inclusion or grouped quantity override. Quantity edits derive
effective quantity from the override or the saved inferred quantity. An
override must be a positive safe integer no greater than 10,000. This matches
the existing planning row limit and bounds later per-unit work. The command
cannot edit Source identity, inferred values, artifact evidence, filament,
role, notes, or manifest fields.

The caller supplies the saved snapshot digest as a whole-draft optimistic
concurrency token. SQLite verifies the stored digest, open state, accepted
baseline, and current base pair inside one `IMMEDIATE` transaction. It updates
the header digest and only the selected child rows whose values differ, then
re-reads the complete draft after both writes. An exact retry whose targets
already have the requested value returns the current draft as unchanged even
when the supplied digest is old. A different edit from an old digest returns a
conflict. PostgreSQL returns `transaction_unavailable` before mutation.

Unit 2b does not mutate accepted Parts, profile layers, Checkoff, accepted
inputs, Build acceptance metadata, or recompute timestamps. It does not add
routes, UI, lifecycle commands, rebase, manifest application, Required-unit
tokens, or Apply.

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
6. Leave the working `profile_layers` selection unchanged. Accepted Source
   input rows remain pinned to the published revision.
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
`plan_revision_required_unit_sets` finalizes each complete mapping with a
`required-unit-map-v1` digest. Unit 3a maps both included and excluded accepted
Parts, so exclusion does not erase physical-slot identity. The Part's included
field determines whether each mapped unit is currently required.

Unit 3a tokens use the canonical `ppu_` prefix followed by 32 lowercase
hexadecimal characters. Object names contain a sanitized STL stem and end in
the complete token. They are immutable, case-insensitively unique, and at most
200 characters. The SQLite v23 migration creates and verifies the complete set
for every clean current accepted revision in one immediate transaction. It
reuses a valid complete set without consuming tokens and fails closed on a
partial set, an orphan unit, an invalid quantity, or a digest mismatch.

Checkoff remains authoritative in `print_progress` during Unit 3a. The internal
current-set reader verifies the immutable mapping, then reads completion and
assembly live through each revision Part's compatibility projection ID and
unit index. It does not copy or mirror progress. PostgreSQL has the same ledger
schema and reader shape, but no Required-unit mutation path until native
multi-statement transactions are available.

Unit 3b saves one immutable reconciliation snapshot at a time. The pure
reconciler uses stable Source identity, equal non-null artifact digests, and
equal effective roles as continuity evidence. Paths, names, Part keys, row
order, null artifact digests, and a prior revision link do not prove identity.
A direct `baseRevisionPartId` selects the known candidate only. Automatic carry
still requires the same Source, equal non-null artifact digest, and equal
effective role. `select_exact_predecessor` may choose only a current ambiguous
candidate that already satisfies that equivalence predicate.
`accept_prior_completion` may choose only the known direct predecessor that
fails the predicate. `replace` chooses no predecessor and carries no token.
Accepting prior completion reuses completed physical tokens only. Missing
target slots receive frozen create assignments.

Each finalized snapshot commits the planning digest, base mapping digest,
decisions, frozen assignments and surplus result, and the live progress rows
that could affect shrink or prior-completion selection. Canonical JSON stores
the complete result and progress basis beside their digests. Readers parse the
typed values, rebuild every component digest, and require assignment rows to
equal the committed result. The selected snapshot promotes the draft to
`plan-draft-v2`. Part inclusion or quantity edits clear the selection in their
existing immediate transaction. Lifecycle transitions preserve it, while a
rebase starts its successor without a selection. SQLite resolves every exact
or superseded idempotent retry inside one immediate transaction, so a delayed
retry cannot pair an old result with a newer selection. PostgreSQL exposes the
schema and verified reads, while reconciliation mutation remains fail closed
until native transactions exist.

Unit 4 provides one idempotent `applyPlanChanges` command. PostgreSQL fails
closed until it has a native transaction implementation. SQLite performs the
complete publication in one immediate transaction. It verifies the current
v2 draft, accepted base, pinned inputs, compatibility projection, selected
ready reconciliation, live selection basis, production references, and saved
Plate plan before the first write. A changed selection basis returns a stale
reconciliation result with zero writes. Checkoff progress updates use the same
immediate transaction boundary, so a concurrent update commits wholly before
Apply or rejects its old Part coordinate wholly after Apply.

Input freshness compares the live Build attachment identity, order, and Source
layer with the saved draft. Apply validates tracked draft inputs against their
immutable Source revisions and publishes those pinned rows. A later Source
revision or naming change does not rewrite or invalidate the reviewed draft.

Apply allocates bounded new Required-unit identities before writing, detaches
the accepted pointer, publishes an immutable accepted revision and input set,
replaces compatibility Parts with fresh IDs, freezes the Required-unit map,
translates live `print_progress`, clears only the saved Plate layout, advances
the accepted pointer and Plan version, consumes the draft, and records one
immutable scalar receipt. Reused tokens keep their Object names and latest
progress. Created tokens start missing. Exact receipt retries return the stored
result before freshness checks, while another key for the consumed draft
returns the same verified receipt. The `plan-revision-parts-v1` digest remains
byte compatible and excludes database projection IDs.
Historical receipt verification binds the immutable request, consumed draft,
reconciliation, revision, and Required-unit mapping. It does not require that
revision to remain the Build's current accepted pointer.

Reconciliation uses stable Source identity, a non-null artifact digest, and
effective role as physical-equivalence evidence. The prior revision link is a
candidate and audit link only. Paths and names do not prove physical
equivalence:

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

Unit 5a separates accepted state from working Source selection. SQLite repairs
each compatibility-dirty v25 Build before removing Source-layer pointer
invalidation. The repair snapshots the live compatibility Parts into a new
legacy accepted revision, advances the Plan version, clears the obsolete
accepted input selection, allocates fresh Build-owned Required-unit identities,
and maps live Checkoff without changing Part IDs or progress rows. A null
accepted pointer with a positive version is repaired even when the Build is
empty. A null pointer at version zero is left alone only when no live Parts
exist. Each Build repair is atomic and restart-safe. PostgreSQL has schema and
trigger parity but performs no synthetic repair without native transactions.
SQLite repeats the dirty repair behind a final immediate cutover barrier. That
barrier validates Plan versions and accepted-input ownership, removes the
legacy layer triggers, and records schema v26 in the same transaction. A layer
write that commits before the barrier is repaired; one that arrives after the
barrier observes the accepted and working separation.

The ordered `plan-source-selection-v1` value is the working input authority.
It is empty or contains one base Source followed by unique add-ons, with at
most 64 Sources. `replaceWorkingPlanSources` validates tenant ownership and an
active Build, compares the complete canonical target before the expected
digest, and replaces the complete layer set in one SQLite immediate
transaction. An exact retry returns unchanged even with an old expected
digest. A different stale target returns conflict. The command changes only
working layers and `config_modified_at`; accepted revisions, accepted input
selection, drafts, compatibility Parts, and Checkoff stay unchanged.

Unit 5b1 adds one verified accepted operational read. The result is a
discriminated union for a ready Plan, a true empty Plan, a compatibility-dirty
Plan, or an uninitialized Plan. A ready result binds the accepted revision,
captured Source inputs, compatibility Parts, Required-unit mappings, and live
Checkoff progress into one aggregate. Compatibility Part IDs remain production
coordinates. They do not establish planning identity.

SQLite reads the aggregate inside one deferred transaction. A concurrent
Apply can therefore produce either the complete old aggregate or the complete
new aggregate, never a mixture. PostgreSQL rereads the accepted terminal
identity and retries the full read once when that identity changes. PostgreSQL
progress writes fail closed until the repository has a native transaction
adapter because the current sync bridge cannot publish their multi-statement
rewrite atomically.

Each text-bearing accepted row has a 64 KiB aggregate UTF-8 limit. Apply and
the v26 repair validate the exact stored rows. The reader fetches text-bearing
rows in pages of 16 and narrow rows in pages of 256 so each PostgreSQL bridge
response remains below its 8 MiB limit. Legacy repaired revisions are ready
with unavailable artifact evidence. Historical format-1 input snapshots remain
uninitialized. Unit 5b1 does not migrate routes or other production callers.

Unit 5b2a moves the Checkoff sheet and Part assembled reads onto the accepted
operational aggregate. Each request that resolves its Plan or Part performs one
verified accepted read, then a pure projection preserves the existing response
shape, including catalog, custom, and Spoolman filament display fields.
Checkoff includes accepted Parts only and sorts filenames with SQLite binary
ordering. The Part route uses its compatibility ID only to locate the Build and
match the accepted projection coordinate. It no longer reads assembled state
through a separate repository path.

Compatibility-dirty and uninitialized Plans return stable conflict responses.
Accepted integrity failures return a stable public error while logs retain only
the coarse integrity code, Plan ID, and requested Part ID when applicable.
Unexpected lookup and read failures also return a stable public error without
exposing internal details. The old
`getPartAssembled` repository method is deleted. The only remaining direct
Checkoff reads are the two assistant callers, and the only remaining enriched
Review read belongs to the Plan Review service.

Plan Review moves in Unit 5b2b. Its current response mixes accepted planning
facts with working Source labels, naming rules, STL filesystem existence, and
thumbnail cache state. Migrating only its Part rows would preserve a misleading
mixed-version result. Unit 5b2b must define and verify the accepted artifact and
media boundary before changing that caller.

The Unit 5b2b foundation separates cheap accepted artifact observation from
verified byte access. Observation checks stored-root containment, portable
case resolution, ambiguous folds, symlinks, regular nonempty file state,
presence, and an optional size bound without hashing. Verified access opens one
descriptor, hashes that descriptor against the accepted SHA-256 digest, and
returns a lease that streams only the hashed byte extent from the same
descriptor. Bytes appended after hashing are not served. Legacy and untracked
evidence remains explicitly unavailable.

Accepted derivative cache identity is the full SHA-256 of the accepted artifact
digest, normalized accepted role and color, derivative variant, and cache
format. PNG cache reads reject paths outside the configured cache, symlinks,
non-files, invalid signatures, and files above the 5 MiB bound. Writes validate
before creating the cache directory, use a mode 0600 exclusive temporary file,
flush it, and rename it atomically in the target directory.

Cache verification forces a publication failure after temporary-file creation,
then proves the prior target survives and the temporary file is removed. A
bounded concurrent process test uses an explicit publication handshake and
proves readers observe both complete old and complete new PNG bytes, with no
missing or partial value. Cache reads retry descriptor identity, size, mtime,
ctime, and post-lstat open rename-window races at most eight times. Permanent
missing, unsafe, oversized, invalid-signature, and stable I/O outcomes return
after one attempt.

This foundation changes no route, Review response, browser API, contract,
database schema, database state, or existing behavior. A production-tree
inventory pins callers of the known accepted-reader, Review, Part-path,
thumbnail-cache, cache-clearing, and Source-thumbnail gateway symbols. It is a
migration checklist, not proof that arbitrary future filesystem code cannot
bypass those gateways. Portable Node filesystem APIs cannot eliminate a
hostile intermediate-directory replacement race, so the verifier still
depends on the application-owned, append-only Source snapshot invariant. The
focused foundation suite passed 29 tests with one Linux-only case-fold test
skipped on case-insensitive macOS. The full server suite passed 148 files and
1125 tests, with one file and three tests skipped. Server typecheck and root
lint also passed.

The first Unit 5b2b production cut moves only the accepted Part media loop.
Part mesh, thumbnail, preview, thumbnail upload, and Plan thumbnail regeneration
now locate a tenant-owned compatibility Part or Build, perform one accepted
operational read when accepted-state evaluation is needed, and match Parts by
the accepted projection coordinate. They do not use the current Source path,
active Source revision, or mutable Part media facts. Legacy and untracked media
remain unavailable. Tracked media opens and verifies the accepted descriptor;
mesh responses hash and stream that same bounded descriptor.

Mesh and derivative responses use strong content-derived ETags. Strong
If-None-Match lists can revalidate a response, while weak validators do not
match. A missing derivative returns the compatibility placeholder without an
ETag and with `Cache-Control: no-store`, so a later upload cannot turn a stale
placeholder into a 304 response. Real derivatives retain strong ETags and
`private, no-cache`. Thumbnail upload requires the strong current mesh basis in
If-Match, buffers at most 5 MiB, then performs its accepted read immediately
before artifact verification and cache publication. An Apply during multipart
reading therefore returns the stable stale-basis conflict without publishing
either the old or new derivative.

The single-reader constraint leaves a narrower race after that accepted read
and before the atomic cache rename. An Apply in that interval may leave an
orphaned old-basis PNG. The cache key contains the accepted artifact digest,
role, color, variant, and format, so old bytes cannot be published under the new
basis. Preventing publication after an Apply would require coordination with
the accepted authority again, such as a second read or transaction-coupled
filesystem publication. That coordination does not belong in this cut.

Browser mesh, rendered blob, and IndexedDB entries are keyed by the 64-character
accepted basis rather than Part ID. IndexedDB version 2 replaces the old Part-ID
store. Each load revalidates the Part URL to discover the current basis; a 304
uses only bytes stored under that basis, and a local miss triggers an
unconditional fetch. A blocked database upgrade settles as a cache miss, late
success after that failure closes its connection, and live connections close on
version change. Invalid accepted metadata returns no thumbnail result without
caching or uploading. Accepted thumbnail rendering uses the accepted response
color. Preview3D may display a caller tint but uploads only when it equals the
accepted response color. The in-memory accepted thumbnail cache has a 20 MiB
LRU byte budget, and the Part-to-basis revalidation index shares the bounded
mesh-cache capacity.

Plan regeneration captures one accepted snapshot and removes only its current
thumbnail and preview bases. Deletion fails closed for absent, symlinked, or
non-directory cache roots while a contained final-entry symlink is unlinked
without following its target. Accepted-media exception logs contain only coarse
route identifiers. Source previews, Plan Review, checklist export, other
exports, role-color working cache helpers, routes, and Review JSON remain
unchanged. Production caller inventories pin both the accepted browser loop and
the deferred working media gateways. The focused server suite passed 35 tests
with one platform skip, and the focused web suite passed 27 tests. The full
server suite passed 149 files and 1129 tests with one file and three tests
skipped. The full web suite passed 98 files and 429 tests. Server and web
typecheck, root lint, and `git diff --check` also passed.

The next Unit 5b2b cut moves HTTP Plan Review and assistant
`get_plan_review` together onto one accepted Review use case. Each request first
checks tenant ownership. Each owned request captures exactly one accepted
operational snapshot. Dirty and uninitialized states stop before filament or
filesystem observation. Ready Reviews derive profile, layer, Part, quantity,
progress, and issue facts from that captured snapshot only. The filament loader
receives only accepted color IDs. Accepted Source roots and included Part
artifacts are observed after capture, then a pure projection produces the
existing public Review JSON. Excluded Parts perform no artifact or thumbnail
observation.

Accepted layer IDs use the accepted input coordinate and retain the accepted
Source ID for links. Stored snapshot paths never enter the response. A layer is
synced only when its tracked accepted root remains safely available. Part order
uses UTF-8 byte filename order followed by projection Part ID. Legacy,
untracked, missing, unsafe, empty, and oversized artifacts retain the public
missing STL behavior. Thumbnail availability uses only the accepted content
basis and an eight-byte PNG signature observation, not the working path cache.
Successful HTTP and assistant responses preserve their prior key sets. Stable
public errors and coarse route logs prevent exception details, accepted paths, and
digests from crossing the boundary.

Review observations are complete by construction: the pure projection rejects
an included Part without a captured media result. Part rows are sorted by UTF-8
filename bytes and projection ID before Part-derived issues are emitted. Issue
categories remain stable as Source availability blockers, the empty-Plan blocker, all
missing-STL blockers, then all stored merge-conflict warnings. Both the full PNG
reader and signature-only observer share one descriptor validation and
post-read stability seam.

The cut deletes the mixed-state `plan-review` builder,
`getEnrichedPartsForReview`, and its private progress helper in the same wave.
Production and test inventories contain no surviving reference to those APIs.
Focused accepted media and Review coverage ran 79 tests: 78 passed and one
platform test skipped. The full server suite passed 152 files with one file
skipped, 1154 tests passed, and 3 tests skipped. The full web suite passed 98
files and 429 tests.
Both typechecks, root lint, both production builds, and the diff check passed.

The first operational cut makes immutable Required-unit tokens plus the complete
accepted Plan basis the only internal identity for Progress writes. Manual
completion and assembly routes use the tenant-owned compatibility Part only to
locate its Build. They capture one request-scoped accepted operational snapshot,
resolve the HTTP coordinate to a token, and pass that token and basis into a
SQLite `IMMEDIATE` command. The command rereads the accepted aggregate and
verifies tenant ownership, the complete basis, and the complete Progress row set
before changing anything. It never repairs Progress on a read or failed command.
Completion fills the prefix; clearing unit N clears N through the end and their
assembly state. Assembly on an incomplete unit remains a successful no-op.
Commands reject Progress and assembly changes after archive inside the same
`IMMEDIATE` transaction. They enforce every coordinate in the accepted Required
unit set while ignoring and preserving legal high-index rows left by an older
accepted revision.

Archive recomputes accepted included-unit totals inside the same transaction as
the archive write. An already archived Plan remains idempotent without requiring
accepted state. The existing combined Plan PATCH remains sequential, so a rename
or special-request update can still survive a later archive failure. Successful
HTTP archive responses and applied assistant archive results preserve their
existing shapes while assistant proposals carry the accepted basis.
Assistant Apply parses a canonical complete basis and binds it to the action
Plan before any command. `get_remaining` and archive eligibility use accepted
snapshot identity and Progress instead of the compatibility ProfileSummary
reader. HTTP archive uses a narrow tenant-owned identity lookup before the
command and reads ProfileSummary only to produce the existing successful
response shape.

Printer verification parses legacy Part and unit coordinates only at the JSON
boundary, resolves them against one request-scoped accepted snapshot, and passes
tokens to one outer `IMMEDIATE` command. That command rereads the accepted
aggregate, rereads and compares the Checkoff link, validates prefix decisions,
and commits Progress, link state, and outcome events together. GET and failed
verification do not repair or rewrite legacy links.
PostgreSQL fails closed before any command read because this unit has no native
transaction implementation there. Logs and public errors expose only stable,
coarse fields.

Focused proofs cover both real two-connection archive and uncheck orderings, a
paused reverse Apply race, injected printer verification rollback, strict
cross-Plan assistant basis rejection with no writes or fact leakage, and
query-free PostgreSQL failures across flat, versioned, printer, and assistant
boundaries.

The cut deletes `patchPartProgress`, `patchPartAssembled`,
`ensureProgressForPart`, `getCheckoff`, `archiveProfile`,
`applyCheckoffUnits`, and the prefix compatibility helper. ProfileSummary,
Plate, printer queue and link schema, filesystem, and web UI remain deferred.
`printUnitTotals` and `printUnitsByPartId` remain temporarily pinned to the
ProfileSummary, merge-export, and legacy Checkoff name-mapping callers for the
next read-authority unit. The focused migration suite passed 225 tests across
13 files. The full server suite passed 154 files with one file skipped, 1174
tests passed, and 3 tests skipped. The full web suite passed 98 files and 429
tests. Both typechecks, root lint, both production builds, and the diff check
passed.

## Module shape

```ts
backfillAcceptedPlanRevisions(db): BackfillResult
readAcceptedPlanRevision(buildId): AcceptedPlanRevision | null
readAcceptedPlanOperationalSnapshot(buildId): ReadAcceptedPlanOperationalSnapshotResult
acceptedProgressSummary(snapshot): AcceptedProgressSummary
setAcceptedUnitCompletion(command): SetAcceptedUnitCompletionResult
setAcceptedUnitAssembly(command): SetAcceptedUnitAssemblyResult
archiveAcceptedPlan(command): ArchiveAcceptedPlanResult
verifyAcceptedPrint(command): VerifyAcceptedPrintResult
recomputePlanDraft(buildId, actorId): PlanDraft
applyManifestToPlanDraft(draftId): PlanDraft
diffPlanDraft(draftId): PlanDraftDiff
rebasePlanDraft(command: RebasePlanDraftCommand): RebasePlanDraftResult
applyPlanChanges(command: ApplyPlanChanges): ApplyPlanResult
```

Contracts own the wire values. Repository code owns tenant-filtered
persistence. Pure services own canonical serialization, diffing, and
Required-unit reconciliation. Routes parse actor, expected version, and
idempotency values at the boundary.

The current saved-draft edit command persists only inclusion and quantity
override decisions. Source selection, naming, and manifest-derived fields are
fresh recompute inputs, not additional saved edit operations for rebase to
replay.

## Implementation slices

1. Add accepted revision tables and Build pointer fields. Backfill SQLite and
   add a parity reader. Preserve every existing behavior and byte of Checkoff
   state.
2. Add saved drafts and draft recompute in units. Unit 2a persists complete
   snapshots and derives accepted-versus-draft diff. Unit 2b adds grouped
   inclusion and quantity decisions. Unit 2c adds abandon, resume, and rebase.
   Accepted reads and Checkoff remain unchanged throughout this slice.
3. Add Required-unit identity, then explicit reconciliation decisions. Unit 3a
   creates the immutable current accepted-revision ledger without changing
   Checkoff. Unit 3b owns reconciliation and saved decisions.
4. Add the atomic, idempotent apply command and refresh compatibility
   projections inside its transaction.
5. Separate accepted state from working Source selection, repair existing
   SQLite compatibility-dirty Builds, then migrate callers away from direct
   accepted-part mutation paths.

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
