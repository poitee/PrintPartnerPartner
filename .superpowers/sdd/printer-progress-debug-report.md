# Printer Progress Production Debug Report

Date: 2026-08-19 UTC  
Base: `origin/main` at `b5637d4`  
Branch: `cursor/fix-printer-progress-2c41-fdc1`

## Scope

Investigated the full path from Moonraker/PrusaLink status polling through filename/object normalization, checkoff-link storage, Progress queries, the Confirm action, and print-progress persistence.

Reported symptoms:

1. Amber `Confirm these parts` cards for `.bgcode` jobs had dim/disabled Confirm controls and could not mark parts printed.
2. Parts in currently printing jobs did not appear as printing in Progress.

## End-to-end trace

1. `PrinterLiveStrip` polls linked Moonraker and PrusaLink integrations through `POST /printer-checkoff/reconcile`.
2. Integration adapters return normalized host state, progress, and current/recent filename.
3. Reconcile first advances existing watching links, then auto-discovers an active job from the printer's object list and default plan binding.
4. Object labels are matched to plan STL filenames and stored as checkoff `units`.
5. Progress loads `watching` and `awaiting_verify` links.
6. `PrintVerifyPanel` enables Confirm only when `pendingUnits(link).length > 0`.
7. Confirm sends unit decisions to `POST /printer-checkoff/verify`.
8. `verifyPrinterCheckoff` validates the units and calls `patchPartProgress`; confirmed units are persisted in plan Progress.

## Hypotheses and runtime verdicts

### A — Zero-unit links disable Confirm

Confidence before reproduction: high.  
Verdict: confirmed.

The API reproduction created an `awaiting_verify` link with a visible filename but `units: []`. The verify boundary received zero decisions and returned 400. The UI independently disables both actions when `units.length === 0`.

Pre-fix instrumentation:

```json
{"message":"verify request","data":{"decisionCount":0}}
```

A control reproduction using the same route with one valid mapped unit succeeded and persisted Progress:

```json
{"message":"verify persisted","data":{"state":"verified","unitsConfirmed":1,"unitsMarked":1}}
```

This rejected the alternative hypothesis that Progress persistence itself was broken.

### B — Server object matching loses generated `.bgcode` labels

Confidence before reproduction: high.  
Verdict: confirmed.

The smallest Prusa API reproduction returned:

- status: `printing`
- filename: `bracket.bgcode`
- extracted object name: `bracket_01`
- plan part: `bracket.stl`

Pre-fix boundary log:

```json
{"message":"active print mapping","data":{"objectNames":["bracket_01"],"matched":[["bracket_01",[]]],"units":[]}}
```

The browser-side proposal matcher already strips slicer extensions and generated `_01`/`_02` unit suffixes. The server-side matcher only compared exact basenames plus `.stl`/`_stl`, so equivalent labels diverged across the upload and live-discovery paths.

Post-fix boundary log:

```json
{"message":"active print mapping","data":{"objectNames":["bracket_01"],"matched":[["bracket_01",["bracket.stl"]]],"units":[{"part_id":1,"unit_index":0}]}}
```

### C — Prusa `.bgcode` metadata extraction fails

Confidence before reproduction: medium.  
Verdict: rejected for the reproduced path; production-wide behavior remains unproven.

The mocked PrusaLink download returned plaintext `objects_info` metadata in the first range and the adapter extracted `bracket_01` successfully. The failure occurred after extraction, in filename matching. No adapter change was justified by the available evidence.

### D — Newly discovered active links are not surfaced to mounted Progress

Confidence before reproduction: high.  
Verdict: confirmed.

The route computed `updates` before creating the active-print link. The newly created link was stored after reconciliation, while the response still had `updates: []`.

Pre-fix log:

```json
{"message":"active print link created after reconcile","data":{"unitCount":0,"updateCountReturned":0}}
```

`PrinterLiveStrip` only called `onCheckoffUpdate` for entries in `updates`, so `PrintVerifyPanel` and Progress part annotations did not reload when the link was discovered. A page reload or later terminal event was required.

The route now returns `created_links`, and the web poller notifies Progress for each new link's immutable `profile_id`.

### E — PrusaLink `ATTENTION` or filename mismatch causes both symptoms

Confidence before reproduction: medium.  
Verdict: inconclusive for the screenshot's failed rows and rejected as the cause of the reproduced missing/disabled-part paths.

`ATTENTION` intentionally maps to host error today and can explain the screenshot's failed rows. The two reported bugs reproduced with a normal `PRINTING`/`FINISHED` lifecycle, so changing `ATTENTION` semantics without a real printer payload would be speculative.

## Root causes

1. The server matcher did not normalize generated unit suffixes or sliced extensions, even though the browser proposal path did. Valid object labels therefore became zero-unit links.
2. Auto-created active-print links were omitted from the reconcile response's change signal. The mounted Progress UI did not reload them.
3. Plan-only zero-unit links are intentionally legal, but `awaiting_verify` queries did not repair legacy zero-unit records. The UI rendered the filename card while correctly disabling Confirm because there were no decisions it could submit.

## Fix

- Added conservative server matching for repeatedly stripped slicer/mesh extensions, Prusa `_stl`, and generated trailing unit numbers. Direct exact matches still take precedence.
- Allocated only currently incomplete plan units when mapping live labels.
- Used the host filename as a single-part fallback when object metadata is missing.
- Repaired legacy zero-unit `awaiting_verify` links during Progress retrieval, then persisted the recovered units before returning them.
- Returned newly created links from reconcile and notified the Progress page immediately.
- Kept verify-first semantics: printer status never auto-ticks Progress; only operator Confirm persists a printed unit.

## TDD evidence

Failing tests were committed before production fixes in `5b772a1`.

Observed red failures:

- generated unit suffixes produced empty matcher results;
- sliced `.bgcode` filenames did not match corresponding STL files;
- reconcile omitted `created_links`;
- legacy awaiting cards remained `units: []`;
- `PrinterLiveStrip` never called the Progress reload callback.

After the minimal fixes, the focused suites passed:

- server: 6 files, 39 tests;
- web: 2 files, 6 tests.

Post-cleanup focused filename-repair test: 1 file, 3 tests passed.

## Full verification

- Server Vitest: 125 passed, 1 skipped; 776 tests passed, 2 skipped.
- Web Vitest: 82 files passed; 364 tests passed.
- ESLint: passed.
- Server and web TypeScript typecheck: passed.
- Contracts, domain, server, and web production builds: passed.
- Web browser smoke test: passed.
- `git diff --check`: passed before the route-fix commit.

Temporary NDJSON instrumentation was removed after post-fix logs proved the corrected mapping and persistence path.

## Commits

- `5b772a1` — failing regression tests
- `75abd2e` — normalized matching and Progress reload handling
- `519162c` — route mapping, legacy repair, and created-link response
- `53697a7` — explicit legacy filename fallback coverage

## Review and concerns

- CodeRabbit CLI 0.7.3 is installed but not authenticated. `coderabbit auth status --agent` returned `not_authenticated`; `coderabbit auth login --agent` required interactive browser authentication, so CodeRabbit review could not run in this environment.
- The recovery heuristic is intentionally conservative. A truly opaque multi-part file with no object metadata and a filename that matches no plan part remains unmapped and still requires manual attribution rather than guessing.
- PrusaLink `ATTENTION` behavior was not changed. A real `/api/v1/status` and `/api/v1/job` payload captured while a printer is simultaneously in attention and actively printing would be needed before changing that state mapping.
- The requested branch name was `cursor/fix-printer-progress-2c41`; Cloud branch policy required the created branch to end in `-fdc1`.
