# Slicer Instances (Plan 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users register slicer instances (stock Orca/Prusa/Bambu or custom) with GUI URL + watch path + dialect, drive Export slicer links from those instances, and bind profile-sync watchers to enabled instance watch paths (env `SLICER_*_DIR` seeds defaults).

**Architecture:** New `slicer_instances` table (schema v15). CRUD API + Settings → Slicers UI. `profile-sync` builds watch roots from enabled instances (fallback to env-based roots when no rows). Export `SlicerLinksPanel` loads enabled instances’ `gui_url` (fallback to hardcoded `SLICER_LINKS` only if zero enabled instances). Docker lifecycle fields may be stored as null/defaults for Plan 3 — **do not** implement pull/start/stop/logs in this plan.

**Tech Stack:** TypeScript monorepo (`web/`), Vitest, Drizzle SQLite/Postgres, Fastify, React settings UI.

**Spec:** `docs/superpowers/specs/2026-08-17-slicer-hub-profile-assignment-design.md` — ship step 2 only.

**Deferred:** Plan 3 Docker lifecycle; Plan 4 export plate handoff; native slicer projects.

## Global Constraints

- Preserve 3MF `object@name` = STL basename / `name (n)` — no export-3mf changes.
- Schema bump **14 → 15** in `schema.ts`, `schema-pg.ts`, `client-postgres.ts`, schema tests (lockstep).
- Custom instances **require** `dialect` + `watch_path` when `enabled`.
- Dialects: `orca_json` | `bambu_json` | `prusa_ini` map to existing sync parsers (`orca`/`bambu`/`prusa` kinds).
- SaaS `DEPLOY_MODE=saas`: allow CRUD for URLs/watch paths; no Docker ops (already N/A this plan).
- Do not request ThunderKeys for review; do not use Snyk.
- Run Node commands from `web/`.
- YAGNI: no Docker Engine API, no compose start/stop, no container logs.

## File map

| File | Responsibility |
|------|----------------|
| `web/apps/server/src/db/schema.ts` / `schema-pg.ts` / `client-postgres.ts` | v15 `slicer_instances` |
| `web/apps/server/src/db/schema-v9.test.ts` | Assert table + version 15 |
| `web/apps/server/src/db/repository.ts` | Instance CRUD + seed helpers |
| `web/apps/server/src/services/slicer-instances.ts` | Presets, dialect→kind map, seed-from-env |
| `web/apps/server/src/routes/slicer-instances.ts` | REST API |
| `web/apps/server/src/services/profile-sync.ts` | Watch roots from instances |
| `web/apps/server/src/app.ts` | Register routes; reconfigure sync on enable/disable when practical |
| `web/apps/web/src/api/engine.ts` | Client API |
| `web/apps/web/src/pages` or settings components | Settings → Slicers UI |
| `web/apps/web/src/components/export/SlicerLinksPanel.tsx` | Instance-driven links |
| `web/apps/web/src/lib/slicerLinks.ts` | Keep as fallback constants |
| `docs/API.md` / `docs/ARCHITECTURE.md` | Document endpoints |

---

### Task 1: Dialect helpers + presets (pure)

**Files:**
- Create: `web/apps/server/src/services/slicer-instances.ts`
- Create: `web/apps/server/src/services/slicer-instances.test.ts`

**Interfaces:**
- Produces:
  - `export type SlicerInstanceKind = "orca" | "prusa" | "bambu" | "custom"`
  - `export type SlicerDialect = "orca_json" | "bambu_json" | "prusa_ini"`
  - `export function dialectToSyncKind(dialect: SlicerDialect): "orca" | "prusa" | "bambu"`
  - `export function defaultWatchDirs(dialect: SlicerDialect): { printer: string; process: string; filament: string }`
  - `export type SlicerInstancePreset = { kind: Exclude<SlicerInstanceKind,"custom">; name: string; dialect: SlicerDialect; gui_url: string; watch_path: string }`
  - `export function stockPresets(env: NodeJS.ProcessEnv): SlicerInstancePreset[]`

Mapping:
- `orca_json` → sync kind `orca`, dirs under `.config/OrcaSlicer/user/default/{machine,process,filament}`
- `bambu_json` → `bambu`, BambuStudio paths (same as today)
- `prusa_ini` → `prusa`, PrusaSlicer paths

Presets default `gui_url` to current hardcoded hosts (`http://orca.home` etc.) and `watch_path` from `SLICER_ORCA_DIR` / `SLICER_PRUSA_DIR` / `SLICER_BAMBU_DIR` or `/slicer-profiles/{orca,prusa,bambu}`.

- [ ] **Step 1: Write failing tests** for `dialectToSyncKind`, `defaultWatchDirs`, `stockPresets` env override
- [ ] **Step 2: Run — FAIL**
- [ ] **Step 3: Implement**
- [ ] **Step 4: Run — PASS**
- [ ] **Step 5: Commit** `feat(server): add slicer instance dialect and preset helpers`

---

### Task 2: Schema v15 — `slicer_instances`

**Files:** schema.ts, schema-pg.ts, client-postgres.ts, schema-v9.test.ts

**Table `slicer_instances`:**
- `id` TEXT PK (e.g. `slicer-<uuid>`)
- `tenant_id` TEXT NOT NULL DEFAULT `'default'`
- `name` TEXT NOT NULL
- `kind` TEXT NOT NULL
- `dialect` TEXT NOT NULL
- `gui_url` TEXT NOT NULL DEFAULT `''`
- `watch_path` TEXT NOT NULL DEFAULT `''`
- `docker_target` TEXT NOT NULL DEFAULT `'local'`  -- stored for Plan 3; unused here
- `docker_host` TEXT
- `compose_service` TEXT
- `image` TEXT
- `container_name` TEXT
- `ports_json` TEXT NOT NULL DEFAULT `'[]'`
- `volumes_json` TEXT NOT NULL DEFAULT `'[]'`
- `env_json` TEXT NOT NULL DEFAULT `'{}'`
- `status_cache` TEXT NOT NULL DEFAULT `'unknown'`
- `status_message` TEXT
- `enabled` INTEGER NOT NULL DEFAULT 1 (SQLite) / boolean (PG)
- `created_at` TEXT NOT NULL
- `updated_at` TEXT NOT NULL

- [ ] **Step 1: Failing schema test** expects version `"15"` and table present
- [ ] **Step 2: Run — FAIL**
- [ ] **Step 3: Add Drizzle + migrations both dialects**
- [ ] **Step 4: Run — PASS**
- [ ] **Step 5: Commit** `feat(db): add v15 slicer_instances table`

---

### Task 3: Repository CRUD + seed-from-env

**Files:** `repository.ts`, tests

**Methods:**
- `listSlicerInstances(): SlicerInstanceRow[]`
- `getSlicerInstance(id: string): SlicerInstanceRow | null`
- `upsertSlicerInstance(input): SlicerInstanceRow`
- `deleteSlicerInstance(id: string): boolean`
- `seedStockSlicerInstancesIfEmpty(env): number` — if zero rows for tenant, insert three presets from `stockPresets(env)` with `enabled=true`

Call `seedStockSlicerInstancesIfEmpty` from app startup (self-host) after DB connect — once per process is fine; method is idempotent via empty-check.

- [ ] **Step 1: Failing repo tests** (CRUD + seed only when empty)
- [ ] **Step 2–4: Implement + PASS**
- [ ] **Step 5: Commit** `feat(db): slicer instance repository CRUD and env seed`

---

### Task 4: HTTP API

**Files:**
- Create: `web/apps/server/src/routes/slicer-instances.ts`
- Create: `web/apps/server/src/routes/slicer-instances.test.ts`
- Modify: `core-routes.ts` / `app.ts` to register

**Routes:**
- `GET /slicer-instances` → `{ instances: [...] }`
- `POST /slicer-instances` → create (body: name, kind, dialect, gui_url, watch_path, enabled?; custom requires dialect+watch_path)
- `PUT /slicer-instances/:id` → update
- `DELETE /slicer-instances/:id` → 204
- `POST /slicer-instances/seed-defaults` → run seed helper (optional; useful for tests/UI)

Validate kind/dialect enums; 400 on invalid custom without watch_path when enabling.

- [ ] **Step 1: Failing inject tests**
- [ ] **Step 2–4: Implement + PASS**
- [ ] **Step 5: Commit** `feat(api): expose slicer instance CRUD endpoints`

---

### Task 5: Profile-sync binds to instances

**Files:** `profile-sync.ts`, tests, `app.ts` if needed

**Behavior:**
1. Add `buildProfileSyncSettingsFromInstances(instances: Array<{ enabled: boolean; dialect: string; watch_path: string }>): ProfileSyncSettings`
2. For each enabled instance with existing `watch_path`, push a root using `dialectToSyncKind` + `defaultWatchDirs`
3. Change startup: if `listSlicerInstances()` nonempty, use instance-based settings; else keep `buildProfileSyncSettings(env)` (backward compatible)
4. After seed, prefer instances so seeded stock rows drive watchers

Optional: expose `reloadProfileSync(repo)` used by routes after enable/disable — if reload is hard with current chokidar lifecycle, document “restart required” in UI for v1 of Plan 2 and still persist correctly (watcher picks up on next process start). Prefer best-effort reload if existing profile-sync API already supports stop/start.

- [ ] **Step 1: Unit tests** for building roots from instance rows
- [ ] **Step 2–4: Wire + PASS**
- [ ] **Step 5: Commit** `feat(sync): watch slicer instance profile paths`

---

### Task 6: Settings → Slicers UI + Export links

**Files:**
- Create: `web/apps/web/src/components/settings/SlicersSettingsCard.tsx` (or page section)
- Wire into Settings page (find existing settings layout)
- Modify: `engine.ts` client helpers
- Modify: `SlicerLinksPanel.tsx` to `fetchSlicerInstances()` and render enabled with `gui_url`; if empty list, fall back to `SLICER_LINKS`

UI:
- List instances: name, kind, dialect, enabled toggle, Open GUI link, last path
- Add from preset (Orca/Prusa/Bambu) or Custom
- Edit name, gui_url, watch_path, dialect (custom), enabled
- Delete with confirm
- Empty state CTA: Seed defaults

- [ ] **Step 1: API client types + functions**
- [ ] **Step 2: Settings card**
- [ ] **Step 3: Export links panel**
- [ ] **Step 4: `npm run typecheck`**
- [ ] **Step 5: Commit** `feat(web): Settings Slicers hub and instance-driven export links`

---

### Task 7: Docs + verification

- Update `docs/API.md` with `/slicer-instances` routes
- Update `docs/ARCHITECTURE.md` one bullet: Slicer Hub instances drive sync + links
- Mark Plan 1 complete / Plan 2 in progress in a short note at top of design spec Status line

```bash
cd web && npx vitest run apps/server/src/services/slicer-instances.test.ts \
  apps/server/src/db/schema-v9.test.ts \
  apps/server/src/routes/slicer-instances.test.ts
cd web && npm run typecheck
```

- [ ] Commit docs `docs: document slicer instance API`

---

## Self-review vs spec step 2

| Spec item | Task |
|-----------|------|
| `slicer_instances` model | 2–3 |
| Settings → Slicers CRUD | 6 |
| Env seeds stock instances | 1, 3 |
| Sync binds watch paths + dialects | 5 |
| Export links from instances | 6 |
| Docker lifecycle | Deferred Plan 3 |
| Export plate handoff | Deferred Plan 4 |

## Suggested follow-ups after Plan 2 merges

- **Plan 3:** Docker lifecycle (local / pp_compose / remote) using stored image/ports/volumes
- **Plan 4:** Export plate → Download / managed Open / deep-link
