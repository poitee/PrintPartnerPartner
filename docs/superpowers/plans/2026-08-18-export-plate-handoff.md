# Export Plate → Slicer Handoff (Plan 4) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On Export, let users send plate 3MF(s) to a slicer via Download (existing), Open in managed slicer (stage into exchange volume + open GUI), or Open with local app (best-effort deep link with download fallback)—without changing 3MF `object@name` contracts.

**Architecture:** Reuse `runExport3mfJob` for plate files. New server helper stages files under a host-visible exchange root (`PP_EXCHANGE_DIR`, default `/exchange`). New API stages plates for a chosen slicer instance and returns `gui_url` + staged paths. Export UI adds a “Send plate(s) to slicer” card with three actions and short explanations. No native slicer project packages.

**Tech Stack:** TypeScript monorepo (`web/`), Vitest, Fastify, React Export page.

**Spec:** `docs/superpowers/specs/2026-08-17-slicer-hub-profile-assignment-design.md` — ship step 4 only.

**Deferred:** Native slicer project export; embedding assigned profiles into vendor project formats.

## Global Constraints

- Preserve 3MF `object@name` = STL basename / `name (n)` — **do not** change `export-3mf` naming.
- Multi-plate: zip download OR sequential staging for managed open (one plate at a time preferred in UI copy).
- SaaS: managed open may be unavailable if no exchange volume — return clear 400/403; Download always works.
- Do not request ThunderKeys; do not use Snyk.
- Run Node commands from `web/`.
- YAGNI: no silent injection into arbitrary desktop installs; no WebSocket file push into slicer GUIs.

## File map

| File | Responsibility |
|------|----------------|
| `web/apps/server/src/services/slicer-handoff.ts` | Stage 3MF paths into exchange dir; deep-link URL builders |
| `web/apps/server/src/services/slicer-handoff.test.ts` | Staging + path safety tests |
| `web/apps/server/src/routes/slicer-handoff.ts` | `POST /slicer-instances/:id/open-plates` |
| `web/apps/server/src/routes/core-routes.ts` | Register routes |
| `web/apps/server/src/config.ts` | `exchangeDir` from `PP_EXCHANGE_DIR` |
| `web/apps/web/src/api/engine.ts` | Client helper |
| `web/apps/web/src/components/export/SlicerHandoffPanel.tsx` | Download / managed open / local app UI |
| `web/apps/web/src/pages/ExportPage.tsx` | Mount panel near slicer links |
| `docs/API.md` / `docs/ARCHITECTURE.md` | Document handoff |

---

### Task 1: Stage helper (pure + fs)

**Files:** create `slicer-handoff.ts` + tests

- `stagePlatesToExchange(opts: { exchangeRoot: string; instanceId: string; sourcePaths: string[]; planSlug: string }): { staged: Array<{ source: string; dest: string; filename: string }> }`
- Resolve dest under `join(exchangeRoot, "pp-inbox", instanceId, planSlug)` — create dirs; copy files (not move).
- Reject path escape outside `exchangeRoot` / outside known exports dir when validating sources.
- `localAppOpenHint(filename: string): { scheme_attempt: string | null; note: string }` — best-effort `file://` is not usable from browser; return honest note that browser will download instead unless a custom protocol exists later.

- [x] Tests for staging + escape rejection
- [x] Commit `feat(server): stage export plates into slicer exchange inbox`

---

### Task 2: API `POST /slicer-instances/:id/open-plates`

**Body:** `{ profile_id, layout_mode?: "per_plate"|"zip", missing_only?: boolean, plate_scope?: "all" }`

**Flow:**
1. Validate instance exists + enabled + `gui_url` when opening managed.
2. Run `runExport3mfJob` into normal exports dir.
3. Stage resulting paths into exchange inbox for that instance.
4. Return `{ gui_url, staged: [...], download_paths: [...], object_count, warnings }`.

If `PP_EXCHANGE_DIR` missing / unwritable → 400 with actionable detail (Download still available via existing job).

- [x] Inject tests with temp dirs
- [x] Commit `feat(api): open plates into managed slicer exchange`

---

### Task 3: Export UI panel

- New `SlicerHandoffPanel` with three actions:
  1. **Download 3MF** — existing `startExport3mf` / handlers
  2. **Open in managed slicer** — pick enabled instance (select); call open-plates; toast + `window.open(gui_url)`
  3. **Open with local app** — trigger download + short explanation toast (best-effort)
- Mount on Export page near `SlicerLinksPanel`.
- Empty state: no instances → link to Settings → Slicers.

- [x] Typecheck
- [x] Commit `feat(web): Export send-plates-to-slicer handoff panel`

---

### Task 4: Docs

- API + architecture bullets; spec status Plans 1–4.

- [x] Commit `docs: document export plate slicer handoff`

---

## Self-review vs spec step 4

| Spec item | Task |
|-----------|------|
| Download 3MF | 3 (existing) |
| Open in managed slicer | 1–3 |
| Local app best-effort | 3 |
| Object name stability | Global — no export-3mf changes |
| Native projects | Deferred |
