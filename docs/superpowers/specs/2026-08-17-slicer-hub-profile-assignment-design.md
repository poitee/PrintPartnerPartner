# Slicer Hub, printer profile assignment, and export-to-slicer

**Date:** 2026-08-17  
**Status:** Plan 1 shipped (printer profile assignment). Plan 2 (slicer instances) in progress. Plans 3–4 deferred.  
**Approach:** Unified Slicer Hub (Settings) — slicer instances + printer profile assignments; Export loses the flat Profile library and gains clearer plate → slicer handoff.

## Problem

1. **Profile library** on Export is a flat, read-only dump of every Process / Printer / Filament profile. Users need profiles **assigned per fleet printer**, with a clear **last synced** time, not a card grid of everything.
2. **Slicer Dockers** are hardcoded in `pp-compose.yml` (Orca/Prusa GUIs, fixed URLs). Users need to **configure, start/stop, and add** slicer containers — including custom images — across local Docker, the pp-compose stack, and remote Docker hosts.
3. **Export → slicer** should let the user send **plate(s)** into a slicer to choose settings there. A browser cannot silently inject files into an arbitrary desktop install; we need honest delivery paths (download, managed Docker open, best-effort deep links).
4. **Progress detection** depends on stable **3MF object names**. Any export or “open in slicer” path must keep names matchable so Print Partner can tell which parts are being printed.

## Goals (v1)

- Remove Export **Profile library**; surface assignment + sync status on **Settings → Printers**.
- Add **Settings → Slicers** (Slicer Hub) for instance CRUD and full container lifecycle.
- Per printer: assign **machine** profile; **filament per slot**; show **compatible process** profiles (read-only); **last synced** = latest `last_synced_at` among assigned machine + slot filaments; toggle **Use assigned profiles** vs **Auto-match by name**.
- Export: send one / selected / all plates via **Download 3MF**, **Open in managed slicer**, **Open with local app (best-effort)** — with short UI explanations.
- Preserve **object `@name`** contract for Progress / verify-first detection.
- Basics first: Core per-plate 3MF (not full slicer projects). **Revisit native slicer project export** after basics work.

## Non-goals (v1)

- Emitting full Orca/Bambu/Prusa **native project** packages (printer + process pre-selected). Tracked as an explicit follow-up.
- SaaS-hosted Docker management (self-host / compose / user-provided Docker only).
- Operating on Docker containers that Print Partner did not label/own.
- Blind auto-tick of Progress from host success (verify-first remains).

## Current context (brief)

| Area | Today |
|------|--------|
| Profile library | `ProfileLibraryPanel` on Export; `GET /profile-library`; sync via `profile-sync.ts` + `SLICER_{ORCA,PRUSA,BAMBU}_DIR` |
| Assignment | Fuzzy name match in `slicer-routing.ts`; `printer_name_map` has no write UI |
| Docker slicers | Fixed `pp-compose.yml` + hardcoded `slicerLinks.ts` |
| 3MF | Per-plate Core + Materials; meshes packed on bed; names = STL basename / `name (n)` |
| Detection | `parseSlicedObjects` reads `object@name`, EXCLUDE_OBJECT, M486 |

---

## Architecture

**Slicer Hub (Settings → Slicers)** is the control plane for:

1. **Slicer instances** — stock (Orca / Prusa / Bambu) or custom; each has Docker target (`local` | `pp_compose` | `remote`), image, ports, volumes, GUI URL, profile watch path, and dialect (`orca_json` | `bambu_json` | `prusa_ini`).
2. **Fleet printers (Settings → Printers)** — profile assignment UI on each printer card/row (see Data model).

**Export page:** remove `ProfileLibraryPanel`. Slicer links come from enabled instances’ `gui_url` (fallback to current hardcoded links only if no instances exist).

**Sync:** watchers bind to each enabled instance’s `watch_path` + dialect (env `SLICER_*_DIR` still seeds default stock instances on first run).

**Routing:** when a printer’s toggle is **assigned**, auto-slice uses machine + per-slot filaments; process is still chosen from the **compatible** list via existing heuristic / job setting. When **auto-match**, keep today’s name-matching (and `printer_name_map` for that mode only).

**Export → slicer:** hand off the same per-plate 3MFs Print Partner already builds; user finishes settings in the slicer unless they opt into embedding assigned profiles when the format allows (optional checkbox).

---

## Data model

### `slicer_instances` (new)

| Field | Notes |
|-------|--------|
| `id`, `name` | |
| `kind` | `orca` \| `prusa` \| `bambu` \| `custom` |
| `dialect` | `orca_json` \| `bambu_json` \| `prusa_ini` (required for sync, including custom) |
| `gui_url` | Open-in / links panel |
| `watch_path` | Profile sync root |
| `docker_target` | `local` \| `pp_compose` \| `remote` |
| `docker_host` | Optional; remote Engine URL / SSH DOCKER_HOST |
| `compose_service` | Optional; pp-compose sibling name |
| `image`, `container_name` | |
| `ports`, `volumes`, `env` | JSON specs |
| `status_cache` | running / stopped / unknown / error + message |
| `enabled` | Registers/unregisters watch on toggle |

### `printer_profile_assignments` (new, per fleet printer)

- `printer_id`
- `machine_profile_id` (nullable FK → `printer_profiles`)
- `profile_source` — `assigned` \| `auto_match`
- `updated_at`

### `printer_filament_slot_assignments` (new)

- `printer_id`, `slot_index`, `filament_profile_id`

### Existing profile tables

Unchanged provenance: `last_synced_at`, `synced_from_slicer_version`, `source_path`. Optionally add `slicer_instance_id` on synced rows for lineage.

### Derived fields

- **Last synced** (printer) = `max(last_synced_at)` over assigned machine + assigned slot filaments; null → “Not synced”.
- **Compatible processes** = `process_profiles` whose `compatible_printers` matches the assigned machine (or machine name). Not pinned in v1.

### `printer_name_map`

Keep for **auto_match** mode only; do not require it when `profile_source = assigned`.

---

## Docker lifecycle

### Targets (all in v1)

1. **local** — Docker Engine API via socket (`/var/run/docker.sock` or unix/tcp `DOCKER_HOST`).
2. **pp_compose** — manage named sibling services in the pp-compose overlay (compose project API or `docker compose` against that file + project name).
3. **remote** — same Engine API against user-provided `DOCKER_HOST` (tcp/ssh); credentials/TLS/SSH refs stay server-side secrets/env, never in the SPA.

### Operations (per instance)

Pull image; create/update container from stored spec; start; stop; remove (optional); refresh status; bounded log tail.

### Presets vs custom

- Orca / Prusa / Bambu templates prefill image, ports, volumes, dialect, default watch path.
- Custom starts blank but **requires** dialect + `watch_path` for sync.

### Safety

- Only operate on containers/services labeled `printpartner.slicer_instance_id=<id>`.
- Refuse unlabeled foreign containers.
- **SaaS `DEPLOY_MODE`:** hide or disable Docker management UI/API.

### Sync coupling

Enabling an instance registers its watch path; disabling stops watching. Missing path → instance shows “sync unavailable”, not a process crash.

---

## UI / flows

### Settings → Slicers (new)

- List instances: status pill, dialect, last sync activity, Open GUI.
- Add from preset or Custom; edit image/ports/volumes/watch path/docker target; Start / Stop / Pull / Logs.

### Settings → Printers (extend)

- Machine profile picker (synced `printer_profiles`).
- Per filament slot: filament profile picker.
- Compatible processes: read-only chips/list.
- “Last synced …” from assigned machine + slot filaments.
- Toggle: **Use assigned profiles** | **Auto-match by name**.

### Export

- Remove Profile library panel.
- Slicer links from enabled instances.
- **Send plate(s) to slicer** (with short explanations):
  1. **Download 3MF** — any local slicer; browser saves file(s).
  2. **Open in managed slicer** — write into that instance’s exchange volume; open `gui_url`.
  3. **Open with local app (best-effort)** — protocol / OS handoff where supported; on failure, fall back to download and explain that browsers cannot reliably push into desktop apps.

Plate scope: current plate, selected plates, or all plates (reuse `export-3mf`; zip when multiple files).

Optional checkbox: **Include assigned profiles when the format supports it** (does not rename objects).

Empty states: no instances → CTA to add slicer; printer with no machine assignment under “Use assigned” → prompt to assign or switch to auto-match.

---

## 3MF arrangement and slicer handling (basics)

**Source of truth (keep):**

- Pack copies onto each fleet printer’s bed (spacing, margins, height bands).
- Default: **one 3MF per plate** (or zip). Meshes translated onto that bed’s XY.
- Colors = Base Materials display hints only.
- Not a full slicer project: no process/filament presets, no multi-plate vendor project XML, no G-code.

**User expectation in slicer:**

- Objects appear in Print Partner’s packed layout.
- User selects matching printer profile in the slicer if bed differs from the fleet machine.
- Filament/AMS mapping is manual unless optional profile embed is used.
- Prefer importing **one plate file at a time** into the matching machine (UI copy).

**Open-in behavior:** same per-plate files. Multi-plate → zip download or sequential staging for managed open. Do not merge plates unless user chooses existing `single_offset` mode.

**Follow-up (explicit):** native slicer project export so printer/process open pre-selected.

---

## Object names and print detection (non-negotiable)

Progress / verify-first and sliced-file parsing depend on readable object labels:

- Keep naming: STL basename on `object@name` and `partnumber` (e.g. `bracket.stl`; quantity copies `bracket.stl (2)`), via existing `objectDisplayName` / sanitize rules.
- Slicers and hosts must still surface those labels (`EXCLUDE_OBJECT_DEFINE`, M486, `.gcode.3mf` object names) so Print Partner can map units.
- Future native-project or “include profiles” paths **must not** rename, scrub extensions, or replace names with opaque IDs.
- Tests: export asserts names; `parseSlicedObjects` still maps them; guard regressions if a slicer path would rewrite names.

---

## Error handling

| Case | Behavior |
|------|----------|
| Docker unreachable / auth fail | Instance status error + actionable message |
| Unlabeled foreign container | Refuse; do not start/stop/remove |
| Pull/start failure | Surface Engine/compose error text; leave prior container state intact when possible |
| Missing watch path | “Sync unavailable” on instance; no crash |
| Deep-link fail | Download fallback + short explanation |
| “Use assigned” but missing machine/slot | Block auto-slice with CTA to fix assignment; auto-match unaffected |
| SaaS mode | Docker management disabled/hidden |

---

## Testing

**Domain / unit**

- Last-synced helper over assigned profiles.
- 3MF object name stability (basename + quantity).
- Routing respects `assigned` vs `auto_match`.

**Server**

- Slicer instance CRUD.
- Docker adapter fakes for `local`, `pp_compose`, `remote` (label enforcement).
- Profile-sync registers/unregisters instance watch paths.
- Assignment APIs on printers.

**Web**

- Printers assignment UI + toggle.
- Export without Profile library; open-in copy/explanations.
- Links panel driven by instances.

**Manual**

- Import plate 3MF in Orca / Prusa / Bambu — object names visible in object list.
- After slice/print path that preserves names, Progress can still detect objects.

---

## Implementation notes (existing seams)

- Remove or stop mounting: `web/apps/web/src/components/export/ProfileLibraryPanel.tsx` from `ExportPage.tsx`.
- Extend: `PrinterFleetCard` / printers settings; new Slicers settings page/section.
- Replace hardcoded: `slicerLinks.ts` / `SlicerLinksPanel.tsx` with instance-driven URLs.
- Evolve: `profile-sync.ts` from fixed `SLICER_*_DIR` to instance list (keep env as seed).
- Evolve: `slicer-routing.ts` to honor assignments when `profile_source = assigned`.
- Reuse: `export-3mf` job + exchange volume patterns from `pp-compose.yml`.
- Docker: new server module; never expose raw socket to the browser.

## Suggested ship order (within this spec)

1. Data model + printer assignment UI + remove Profile library + routing toggle (no Docker yet, sync still env-based).
2. Slicer instances as config (URLs + watch paths) driving links + sync — still without full lifecycle if needed as a thin slice.
3. Full Docker lifecycle for local + pp_compose + remote.
4. Export plate → Download / managed Open / best-effort deep link polish.
5. (Later) Native slicer project export — separate spec or addendum.

Steps 1–4 are still one product design; implementation may PR them sequentially.
