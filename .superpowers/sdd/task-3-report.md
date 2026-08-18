# Task 3 report: Export and desk-loop workflow consistency

## Status

DONE

Branch: `cursor/full-codebase-audit-2c41`

Implementation HEAD before this report: `e4a5f1f23e649798a3576ea20b777dc8e9375aa2`

## Audit claim verification

The pre-change implementation confirmed every Task 3 claim:

- Slicer handoff fetched the printer fleet and sent every printer id directly,
  while the other export paths fetched the saved print plan and interpreted its
  ids through `resolveEnabledPrinterIds`.
- Library treated an offline engine as an empty library, exposed the “No
  sources yet” action, and gated its fetch on a truthy health object rather than
  `health.ok`.
- Plan had no explicit engine, profile-list loading/error, or plan-data loading
  state. Plans hid profile-list failures and could present failed loads as an
  empty list. Settings displayed empty defaults while its aggregate load was
  pending or failed, and several direct mutation controls stayed enabled
  offline.
- Progress rendered live-printer and mutation controls before its engine state.
  Its optimistic mutation promises were intentionally discarded, producing no
  operator feedback on rejection. Printer activity, checkoff-link, phase,
  suggestion, refresh, and claim failures were swallowed.
- Export mounted and fetched the printer Send panel with no active plan, then
  presented disabled send controls alongside a later no-plan message.
- Profile selection reconciliation used `isFetched`; an initial profile-list
  failure therefore reconciled against `[]` and could clear a stored plan.
- Progress optimistic mutations always targeted the non-excluded review cache.
  After Parts requested the included/excluded review, Progress could update a
  different cache. A failed optimistic write with no previous cache entry also
  left the synthetic entry behind.

## Implementation

- Slicer handoff now fetches the saved print plan and routes both download and
  managed-open printer ids through `resolveEnabledPrinterIds`.
- Library, Plan, Plans, Progress, Export, and Settings now distinguish
  connecting/offline, loading, request error, and empty/no-plan states before
  exposing engine mutation workflows.
- Settings keeps engine controls disabled until the aggregate settings request
  succeeds, preserves a dedicated initial-load error, and offers retry without
  showing failed loads as empty configuration.
- Progress reports optimistic print/assembly failures through Sonner and
  surfaces auxiliary printer/phase failures inline.
- Export does not mount the Send or slicer-input workflows without an active
  plan.
- Profile selection reconciles only after a successful list request.
- Progress mutations target the active included/excluded review cache and
  remove optimistic cache entries that had no prior value when rollback runs.

## Red evidence

`npm run test -w @print-partner/web -- SlicerHandoff Sources Checkoff Profile`

- Exit 1 before implementation.
- 10 intended failures covered saved handoff ids, Library offline precedence,
  Progress mutation/auxiliary feedback, profile and engine states, Settings
  offline controls, and Export without a plan.

`npm run test -w @print-partner/web -- Profile planReview`

- Exit 1 during self-review.
- 4 intended failures covered selection preservation on profile-list failure,
  active review-cache selection, rollback without a previous cache value, and
  Settings initial-load failure gating.

## Green and final verification

Focused workflow suite:

`npm run test -w @print-partner/web -- SlicerHandoff Sources Checkoff Profile`

- Exit 0; 13 files and 78 tests passed.

Focused self-review suite:

`npm run test -w @print-partner/web -- Profile planReview`

- Exit 0; 5 files and 27 tests passed.

Complete web suite:

`npm run test -w @print-partner/web`

- Exit 0; 63 files and 318 tests passed.

Web typecheck:

`npm run typecheck -w @print-partner/web`

- Exit 0; no TypeScript diagnostics.

Repository lint:

`npm run lint` (cwd: `/workspace/web`)

- Exit 0; no ESLint diagnostics.

Diff hygiene:

`git diff --check f28fcf8..HEAD`

- Exit 0.

## Self-review

- Re-read the Task 3 brief and traced each reported state from health/profile
  queries through page rendering and mutation initiation.
- Found and fixed two deeper failure paths during review: failed profile lists
  clearing stored selection, and optimistic Progress updates writing the wrong
  review-cache variant after excluded parts had been requested.
- Verified state branches precede or disable mutation controls and preserve the
  existing desk-ink/paper/brass card and typography language.

## Concerns

- The web test environment is source-contract and pure-function oriented; it
  has no browser DOM test environment or React Testing Library. The new tests
  therefore lock page wiring and state precedence in source rather than
  exercising browser interactions.
- CodeRabbit CLI `0.7.3` is installed but reports `not_authenticated`, so no
  external CodeRabbit review result is available.

## Review blocker follow-up

Implementation HEAD before this report update: `603f774fa540fd89a91f0f49a32d4300f8d0fb95`

### Changes

- Added a shared engine-state decision that distinguishes the initial health
  request from an explicit `ok: false` response. Library, Welcome, Plan, Plans,
  Parts, Progress, Export, Printers, Help, and Settings now use it.
- Added primary-resource decisions that keep cached plans and review/settings
  data visible during background loading or failure while surfacing a
  non-blocking refresh error.
- Split source-category requests from Library and Plan primary data requests;
  category failure now leaves source/layer data usable and appears inline.
- Replaced Settings' aggregate request/readiness gate with endpoint-scoped
  loading, error, and readiness. Printer, slicer, source-category, STL naming,
  integration, build-tracking, and Data & System tools no longer depend on the
  five unrelated inline settings requests. Dialog dismissal remains available
  during engine loss, card copy reflects loading/error/empty states, and
  duplicated readiness checks/chrome were removed.
- Progress tracks auxiliary errors by request key and clears only the recovered
  request's error after success. Cached phase/review data survives refetch
  failures, and unreachable duplicate offline/loading branches were removed.
- Slicer handoff now loads the printer fleet first, stops with specific
  no-printer guidance, and only then requests the active plan's printer ids.
- Removed all six Task 3 source-regex test files. Behavioral tests now exercise
  pure health/resource, settings gate, auxiliary-error, optimistic-cache,
  profile-reconciliation, and handoff-sequencing decisions.

### Red evidence

`npm run test -w @print-partner/web -- workflowState auxiliaryErrors reviewCache slicerHandoff profileSelection`

- Exit 1 before implementation.
- 14 intended assertion failures covered unhealthy-vs-loading health,
  cached-data preservation, independent settings/recovery gates, per-request
  auxiliary recovery, included/excluded review cache selection and rollback,
  successful-list-only profile reconciliation, and printer-before-plan
  handoff sequencing.

### Green and final verification

Focused behavioral suite:

`npm run test -w @print-partner/web -- workflowState auxiliaryErrors reviewCache slicerHandoff profileSelection`

- Exit 0; 5 files and 26 tests passed.

Complete web suite:

`npm run test -w @print-partner/web`

- Exit 0; 61 files and 319 tests passed.

Web typecheck:

`npm run typecheck -w @print-partner/web`

- Exit 0; no TypeScript diagnostics.

Repository lint:

`npm run lint` (cwd: `/workspace/web`)

- Exit 0; no ESLint diagnostics.

Diff hygiene:

`git diff --check aa91be5..603f774`

- Exit 0.

### Follow-up concerns

- The web test project still has no DOM renderer, so the replacement tests
  validate the state/cache decisions as executable pure behavior while
  TypeScript and ESLint validate their React wiring. There is no browser-level
  assertion of the rendered cards or dialogs.

## Minor re-review follow-up

Implementation HEAD before this report update: `d9bfe976e3548c8f835d697b5be6fa3aa14fb94d`

### Changes

- `optimisticReviewCacheKey` is now the canonical
  `queryKeys.planReview` function rather than a duplicate tuple builder; its
  behavioral test requires reference identity and validates both cache
  variants.
- Removed the identity-only profile reconciliation helper and test.
  `ProfileContext` now uses the query's `isSuccess` condition directly.
- Added a pure Settings resource-display decision for loading, initial error,
  background error, and ready states. All five endpoint-scoped cards use it;
  cached values remain enabled while background refresh errors stay visible.
- Renamed all used underscore-prefixed workflow-state parameters.
- Auxiliary errors now remove and reinsert an updated key so property order
  deterministically represents the newest update.
- Offline cards on Library, Plan, Plans, Progress, and Settings now use the
  shared Card chrome defaults. Progress retains only its functional
  `no-print` class.

### Red evidence

`npm run test -w @print-partner/web -- reviewCache auxiliaryErrors workflowState profileSelection`

- Exit 1 before implementation.
- 4 intended failures covered canonical cache-key identity, Settings
  background/initial display states, and updating an existing auxiliary key as
  the newest visible error.

### Green and final verification

Focused behavioral suite:

`npm run test -w @print-partner/web -- reviewCache auxiliaryErrors workflowState profileSelection`

- Exit 0; 4 files and 27 tests passed.

Complete web suite:

`npm run test -w @print-partner/web`

- Exit 0; 61 files and 322 tests passed.

Web typecheck:

`npm run typecheck -w @print-partner/web`

- Exit 0; no TypeScript diagnostics.

Repository lint:

`npm run lint` (cwd: `/workspace/web`)

- Exit 0; no ESLint diagnostics.

Diff hygiene:

`git diff --check 4d1347f..d9bfe97`

- Exit 0.

### Minor re-review concerns

- No new concerns beyond the existing absence of browser-level DOM tests.
