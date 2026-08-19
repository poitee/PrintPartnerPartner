# Printer Progress Production Debug Report

Date: 2026-08-19 UTC
Base: `origin/main` at `b5637d4`
Branch: `cursor/fix-printer-progress-2c41`

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

### E — PrusaLink `ATTENTION` semantics (separate unresolved question)

Confidence before reproduction: medium.
Verdict: inconclusive for the screenshot's failed rows and rejected as the cause of the reproduced missing/disabled-part paths.

`ATTENTION` intentionally maps to host error today and can explain the screenshot's failed rows. This remains a separate, unresolved operational question—not a remaining part of the reproduced Progress fix. The two reported bugs reproduced with a normal `PRINTING`/`FINISHED` lifecycle, so changing `ATTENTION` semantics without a real printer payload would be speculative.

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

Post-cleanup focused printer-checkoff Progress test: 1 file, 3 tests passed.

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
- The branch follows the Cloud Agent naming policy: `cursor/fix-printer-progress-2c41`.

## Follow-up: duplicate unattributed completion

### Reproduction

The post-fix browser walkthrough exposed a second reconcile defect:

1. `Core One Fixed` moved from `printing cube.bgcode` to `complete`.
2. Confirm persisted Progress `1/1` and removed the checkoff card.
3. An `Unclaimed print detected` entry for the same integration and filename remained and reappeared when the printer was selected.

A route-level regression reproduced the same lifecycle with a real repository and mocked PrusaLink boundary:

`PRINTING → FINISHED → repeated FINISHED → Confirm → repeated FINISHED`

The red test failed on the repeated `FINISHED` poll because `unattributed` contained `bracket.bgcode` instead of remaining empty. The unlinked control case, `FINISHED external.bgcode` with no checkoff link, continued to create one unattributed record.

### Hypotheses and runtime verdicts

#### F — `updates.length` only signals the transition poll

Confidence before route reproduction: high.
Verdict: confirmed.

On the first complete poll, reconcile transitioned the watching link and returned one update:

```json
{"message":"reconcile result","data":{"state":"complete","filename":"bracket.bgcode","updateCount":1,"links":[{"filename":"bracket.bgcode","state":"awaiting_verify"}]}}
```

On the repeated complete poll, the same link was no longer watching, so reconcile returned no updates. The external-complete branch then created an unattributed record even though its own boundary trace showed the matching awaiting link:

```json
{"message":"external-complete eligibility","data":{"normalizedFilename":"bracket.bgcode","matchingLinks":[{"state":"awaiting_verify"}]}}
{"message":"creating unattributed print","data":{"filename":"bracket.bgcode","objectCount":1,"candidateCount":1}}
```

#### G — The transitioned or verified checkoff link was deleted

Confidence before route reproduction: low.
Verdict: rejected.

The repeated pre-fix poll loaded the matching link in `awaiting_verify`. Post-fix verification also loaded it after Confirm in `verified`, so checkoff history remained available for deduplication.

#### H — Filename normalization prevented correlation

Confidence before route reproduction: low.
Verdict: rejected.

The live filename and stored checkoff filename both normalized to `bracket.bgcode`; the boundary trace found the matching link by integration and normalized filename.

#### I — Confirm itself created or retained the duplicate

Confidence before route reproduction: medium.
Verdict: rejected as the creation point.

The duplicate existed before Confirm, on the second complete poll. Confirm correctly changed the checkoff link to `verified` and marked one unit; it did not originate the unattributed record.

### Root cause and fix

The external-complete branch treated `updates.length === 0` as equivalent to “this completion has no checkoff link.” That is only true on the transition poll. Every later complete poll has no updates because reconciliation intentionally processes watching links only.

Before creating an unattributed record, the route now checks both:

- existing unattributed records for integration plus normalized filename;
- existing checkoff links for integration plus normalized filename.

This preserves external completion behavior when no link exists while making repeated complete polling idempotent across both `awaiting_verify` and `verified`.

### TDD and post-fix evidence

- Red commit: `ff03a6c`.
- Red result: focused suite had 1 expected failure; repeated complete returned one unattributed `bracket.bgcode`.
- Fix commit: `ab28c3e`.
- Post-fix focused result: 1 file, 5 tests passed.
- Post-fix trace: repeated complete with `awaiting_verify` returned `open: []`.
- Confirm trace: the link transitioned to `verified` with `unitsConfirmed: 1`.
- Post-confirm complete trace: the matching `verified` link returned `open: []`.
- External control trace: unlinked `external.bgcode` executed unattributed creation and returned one open record.
- Temporary NDJSON instrumentation was removed in `0112610` after the post-fix trace proved both paths.

### Follow-up full verification

- Contracts: 1 file, 13 tests passed.
- Domain: 18 files, 127 tests passed.
- Web: 82 files, 364 tests passed.
- Server: 125 files passed, 1 skipped; 778 tests passed, 2 skipped.
- Server and web TypeScript typecheck: passed.
- ESLint: passed.
- Contracts, domain, server, and web production builds: passed.

### Remaining concern

PrusaLink exposes filename and terminal state here, but no stable print-instance identifier. Deduplication therefore uses integration plus normalized filename, matching the existing unattributed-record policy. A newly completed external job that reuses a historical linked filename and was never observed while printing is indistinguishable from a repeated terminal poll; supporting that case reliably would require a host job ID or an explicit observed state-cycle marker.

## Follow-up: migration repair for an existing duplicate

### Reproduction and hypotheses

Manual post-fix verification showed that the prevention fix did not migrate an unattributed record created before `ab28c3e`. A route regression now seeds that stale record beside a linked lifecycle, confirms the unit, repeats reconcile, lists open unattributed prints, and checks both retained claim history and `1/1` Progress.

- **J — stale open records have no repair path:** high confidence; confirmed. Before the repair, reconcile returned the stale record while an exact matching `verified` link remained loaded.
- **K — normalization prevents correlation:** low confidence; rejected. Both records normalized to `bracket.bgcode`.
- **L — Confirm deletes or loses the checkoff link:** low confidence; rejected. The post-Confirm trace retained the matching link in `verified`.
- **M — the existing claim mutation cannot preserve history:** medium confidence; rejected. Post-fix tracing showed `claimUnattributedPrint` persisted `claimed_at` and `claimed_profile_id`.
- **N — repairing linked duplicates suppresses genuinely unlinked completions:** medium confidence; rejected by the control case. `external.bgcode`, with no matching link, remained open.

Pre-fix evidence:

```json
{"message":"reconcile lifecycle state","data":{"state":"complete","normalizedFilename":"bracket.bgcode","matchingLinks":[{"profileId":1,"state":"verified"}]}}
{"message":"reconcile open unattributed result","data":{"open":[{"normalizedFilename":"bracket.bgcode"}],"links":[{"normalizedFilename":"bracket.bgcode","profileId":1,"state":"verified"}]}}
```

Post-fix evidence:

```json
{"message":"unattributed print claimed","data":{"integrationId":"prusa-1","filename":"bracket.bgcode","profileId":1}}
{"message":"reconcile open unattributed result","data":{"open":[],"links":[{"normalizedFilename":"bracket.bgcode","profileId":1,"state":"verified"}]}}
{"message":"unattributed list result","data":{"open":[],"links":[{"normalizedFilename":"bracket.bgcode","profileId":1,"state":"verified"}]}}
{"message":"reconcile open unattributed result","data":{"open":[{"normalizedFilename":"external.bgcode"}],"links":[]}}
```

### Root cause and repair

`ab28c3e` guarded only creation of new unattributed records. `listOpenUnattributedPrints` continued to return already-persisted open records verbatim, and neither reconcile nor the open-list route correlated them with checkoff history.

Reconcile and open-list retrieval now repair only exact `integration_id + normalized filename` matches against `watching`, `awaiting_verify`, or `verified` links. The stale record is claimed to the matching link's profile, preserving history and making it non-open. Records without a matching eligible link are unchanged.

### TDD and verification

- Red regression commit: `700fed9`.
- Red result: focused route suite failed because repeated complete reconcile returned the seeded `bracket.bgcode` record.
- Runtime instrumentation commit: `90877c0`.
- Repair commit: `e3eedf2`.
- Green focused result: 1 file, 6 tests passed.
- Full tests: contracts 13, domain 127, web 364, server 779 passed; server retained 2 skipped tests.
- Server and web TypeScript typecheck: passed.
- ESLint: passed.
- Contracts, domain, server, and web production builds: passed.

Temporary NDJSON instrumentation remains active pending manual post-fix confirmation, per the debug workflow.

## Follow-up: stale Progress client state after repair

### Boundary trace and hypotheses

Manual verification on the repaired backend returned `created_links: []`, `updates: []`, and
`unattributed: []` while Progress still rendered the stale unattributed card and part annotation.
The frontend trace established:

1. `PrinterLiveStrip` reads the reconcile `unattributed` array and calls
   `onUnattributedUpdate(unattributed.length)`.
2. `CheckoffPage` previously discarded that count and always started
   `refreshUnattributedPrints()`.
3. The card and `suggestedPartIds` annotation both derive from the existing
   `unattributedPrints` state array, so neither could disappear until a replacement list request
   completed with fresh data.

- **O — the zero count is discarded at the page callback:** high confidence; confirmed. The red
  UI regression invoked the mounted page callback with `0` while the list query continued to
  return the stale record. Both `Unclaimed print detected` and `Possibly on Core One Fixed`
  remained rendered.
- **P — the reconcile callback is not invoked:** low confidence; rejected. The
  `PrinterLiveStrip` boundary test observes `onUnattributedUpdate(0)` from an empty reconcile
  array.
- **Q — the card and part annotation use separate stale sources:** low confidence; rejected.
  The behavior test showed both are added and removed together from `unattributedPrints`.
- **R — nonzero reconcile updates would be lost by a direct clear:** medium confidence; rejected
  by the control case. A count of `1` still performs the list fetch and renders both UI signals.

The focused red result was one expected failure and one passing nonzero control. The failure was:

```text
expected "Unclaimed print detected Core One Fixed · cube.bgcode" to be absent
received the stale card after onUnattributedUpdate(0)
```

### Minimal fix

`CheckoffPage` now treats the reconcile count as authoritative for the empty case:

- count `0` synchronously clears `unattributedPrints`;
- count greater than zero keeps the existing list refetch, preserving candidate details needed by
  the card and annotation.

This avoids retaining or immediately re-reading a stale record when reconcile has already proved
that no open records exist.

### Automated verification

- Focused web: 2 files, 3 tests passed.
- Focused server reconciliation: 1 file, 6 tests passed.
- Full web: 83 files, 366 tests passed.
- Full server: 125 files passed, 1 skipped; 779 tests passed, 2 skipped.
- Server and web TypeScript typecheck: passed.
- ESLint: passed.
- Contracts, domain, server, and web production builds: passed.

Post-fix server instrumentation still shows the repair and authoritative empty result:

```json
{"message":"unattributed print claimed","data":{"integrationId":"prusa-1","filename":"bracket.bgcode","profileId":1}}
{"message":"reconcile open unattributed result","data":{"open":[],"links":[{"normalizedFilename":"bracket.bgcode","profileId":1,"state":"verified"}]}}
{"message":"unattributed list result","data":{"open":[],"links":[{"normalizedFilename":"bracket.bgcode","profileId":1,"state":"verified"}]}}
```

The unlinked control still returns `external.bgcode` as open. Temporary NDJSON instrumentation
remains active pending manual verification of the frontend clear.
