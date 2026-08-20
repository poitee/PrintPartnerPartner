# August 19 review findings

This file records the findings that led to the stabilization plan. Status is
either accepted, open for discussion, or deferred. No item in this file is an
implementation instruction by itself.

## Product and workflow

- **Open for discussion.** The advertised sequence is Library, Plan, Parts,
  Progress, and Export. The code treats Export as outside the progress spine,
  marks it complete when parts exist, and sends users between Progress and
  Export in both directions.
- **Open for discussion.** Export, Progress, and the Print view in Parts share
  responsibility for printer preparation, assignment, completion, and
  verification.
- **Accepted.** The same-sounding recompute action has different behavior.
  Plan and automatic recompute set `apply_manifest` to `true`. Command-palette
  actions set it to `false`.
- **Accepted.** Help text, README copy, workflow indicators, and screenshots do
  not describe one current workflow.
- **Accepted.** Browser-persisted ordering and bag markers behave differently
  from server-backed progress across devices.
- **Accepted.** STL naming rules already infer filament roles and quantities.
  The workflow does not explain this result or distinguish an inferred
  quantity from a manual override.

## Frontend structure

- **Accepted.** `SourcesPage`, `BuildPage`, `BuildSourcesPanel`, the workflow
  rail, and `PlanWorkspaceContext` compete to own source and plan state.
- **Accepted.** `loadedRevision` is assigned from `revision`, so the existing
  comparison cannot express an older loaded revision.
- **Accepted.** Source attachment and plan-loading behavior are implemented in
  more than one place.
- **Accepted.** `web/apps/web/src/api/engine.ts` combines transport, duplicated
  data types, and unrelated feature endpoints in one 3,380-line file.
- **Accepted.** `engineFetch<T>()` trusts a TypeScript cast instead of validating
  an external response.
- **Accepted.** Large pages are a symptom of unclear ownership. Splitting them
  comes after state and domain decisions.
- **Accepted.** The source naming editor calls `PUT /sources/:id/naming`, but
  the server registers only the matching `GET` route. Source-specific rules
  also disagree with global preview, filtering, and export paths.

## Source and plan correctness

- **Accepted.** GitHub sync writes into an existing source directory. Files
  deleted upstream can remain on disk and return in later plans.
- **Accepted.** GitHub's truncated recursive-tree response is recorded but not
  treated as a failed or incomplete sync.
- **Accepted.** Sync downloads at most 500 STL paths while later scans inspect
  every local STL.
- **Accepted.** A successful source sync does not mark dependent plans stale.
- **Accepted.** Source state needs an immutable revision identity and atomic
  promotion, not another cleanup pass over a mutable directory.

## Jobs and integrations

- **Accepted.** Job snapshots live in process memory and disappear on restart.
- **Accepted.** Cancellation changes job status without stopping the work.
- **Accepted.** Documentation mentions optional BullMQ and Redis support that
  the repository does not implement.
- **Accepted.** Automatic slicing can fall back to the first printer when it
  cannot resolve a mapping.
- **Accepted.** The TypeScript slicer adapter prefers `/v1/slice`, while the
  bundled Python sidecar exposes the older `/slice` endpoint.
- **Accepted.** Spoolman deduction can ignore the encoded integration ID and
  select a different configured server.
- **Deferred.** A durable job state machine belongs in a separate program if
  background work must survive restarts or run across replicas.

## Supported deployment

- **Accepted.** SQLite and local storage are the working self-hosted backend.
- **Accepted.** The Postgres bridge starts a Node subprocess and database client
  for each synchronous query.
- **Accepted.** The Postgres transaction fallback is process-local state, not a
  database transaction.
- **Accepted.** S3 adapters exist, but core source, export, and job flows still
  depend on local paths.
- **Accepted.** Background watchers do not consistently carry tenant context.
- **Open for discussion.** Postgres, S3, and multitenancy remain experimental
  unless SaaS is a near-term product commitment.

## Testing and documentation

- **Accepted.** The repository has broad unit and integration coverage, strict
  TypeScript, and green GitHub CI on the reviewed main commit.
- **Accepted.** Browser tests use static fixtures and do not launch the real web
  and server applications.
- **Accepted.** No browser test drives Library through planning, preparation,
  and completion.
- **Accepted.** Route-level runtime schemas and the OpenAPI document cover only
  a small part of the API despite broader documentation claims.
- **Accepted.** The bundled slicer sidecar has no direct test suite.
- **Accepted.** The screenshot capture script still refers to removed or
  renamed pages and AI features.
- **Accepted.** Current README screenshots show the older Sources, Build,
  Review, and Advisor interface.

## Release and repository trust

- **Accepted.** The `v3.1.0` image manifest exists for AMD64 and ARM64, but the
  release workflow failed during its GHCR visibility step and skipped the
  GitHub release.
- **Accepted.** GitHub still presents `3.0.0-web` as the latest release.
- **Accepted.** The `v3.1.0` tag and current `main` have diverged histories. The
  tag has 207 commits absent from `main`; `main` has 456 absent from the tag.
- **Accepted.** Version ownership is split across package metadata, Docker
  files, Compose files, documentation, and a release script that updates only
  part of that set.
- **Accepted.** The repository has no public issue backlog or roadmap that
  explains the intended product direction.

## Product position

- **Accepted as a working recommendation.** PrintPartner should focus on
  turning several model sources into one reproducible plan and carrying that
  plan through printing.
- **Deferred.** Generic farm ERP features do not earn a place until the core
  workflow works as one product.
