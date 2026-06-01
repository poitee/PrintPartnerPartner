# Print Partner Web — smoke checklist

Run after `docker compose up --build` (self-host) or `docker compose -f docker-compose.saas.yml up` (SaaS + Postgres).

Automated workflow: `BASE=http://localhost:8080 ./web/scripts/workflow-smoke.sh`

## Self-host Docker (`docker compose up --build`)

**Last run:** 2026-05-31 against http://localhost:8080 (branch `web-platform`, commit through c0df07b+fixes)

| Step | Endpoint | Result |
|------|----------|--------|
| Health | `GET /health` | **200** — `ok:true`, `deploy_mode:self-host`, `db.driver:sqlite` |
| Static | `GET /`, `GET /assets/*` | **200** — Vite bundle `index-*.js`, `index-*.css` |
| Add source | `POST /sources` | **200** — GitHub `Klipper3d/klipper` → `id:2` |
| Sync | `POST /jobs/sync` | **200** — job `status:done`, 4 STLs downloaded |
| Create plan | `POST /plans` | **200** — `Smoke Test Plan` → `id:2` |
| Base layer | `PUT /plans/{id}/layers/base` | **200** — layer linked to source |
| Recompute | `POST /jobs/recompute` | **200** — `part_count:4` |
| Parts | `GET /plans/{id}/parts` | **200** — 4 parts (calibrate_size, ringing_tower, …) |
| Checkoff | `GET /plans/{id}/checkoff` | **200** — summary + print_units |
| Progress | `PATCH /parts/{id}/progress` | **200** — `printed_count:1`, `missing:false` |
| STL export | `POST /jobs/export-stl-pack` | **200** — `file_total:4`, `download_url:/exports/.../stl` |
| Review | `GET /plans/{id}/review` | **200** — no blockers |

**Notes**

- Job terminal status is `done` (not `completed`).
- STL pack `download_url` points at an export **directory**; `GET /exports/.../stl/` returns **400** (`Path is a directory`). Use export job result paths or add zip download later.
- Duplicate plan names return **400** (`Profile already exists`).

## SaaS Docker (`docker compose -f docker-compose.saas.yml up --build`)

**Last run:** 2026-05-31 — partial

| Check | Result |
|-------|--------|
| Container starts with `DATABASE_URL` | **Fixed** — was crash on startup (`Cannot create proxy…`); now starts |
| `GET /health` (Postgres) | **200** but `db.connected:false` — sync Drizzle bridge blocks on Postgres queries |
| `POST /plans` (Postgres) | **Hangs** — known: sync repository + async Drizzle/pg promises deadlock |
| SaaS + SQLite (no `DATABASE_URL`) | **200** health, **200** `POST /plans` — use for SaaS UI smoke until async repo lands |
| `GET /auth/me` without session | **401** — expected; use `POST /auth/dev-login` then cookie |
| `STATIC_DIR` in saas compose | **Fixed** — was `/app/static` (404); now `/app/web/apps/web/dist` |

**SaaS smoke without Postgres (port 8081 if self-host on 8080):**

```bash
docker compose -f docker-compose.saas.yml up --build -d  # omit DATABASE_URL env for sqlite fallback
# Or override ports if 8080 busy: edit compose ports to 8081:8080
curl -s http://localhost:8080/health
curl -s -X POST http://localhost:8080/plans -H 'Content-Type: application/json' -d '{"name":"saas-test"}'
```

## Manual UI checks (browser)

- [ ] Add GitHub source, sync, STL tree
- [ ] Create plan, base layer, recompute
- [ ] Review tab, checkoff toggles
- [ ] Export STL pack / checklist HTML / 3MF from UI
- [ ] Kit import (admin or job)

## Sources

- [ ] Add GitHub source (or local zip), set import rules, run sync job
- [ ] Open STL tree and repo manifest endpoints
- [ ] Search STL (`/sources/stl-search?q=...`)

## Build plan

- [ ] Create plan with base layer, add addon layer, recompute (with apply manifest)
- [ ] Apply stack preset from kit catalog (when sources synced)
- [ ] Set role filaments
- [ ] **Persist smoke:** save import rules → reload plan → rules unchanged; PATCH part included/qty survives recompute
- [ ] **Mesh smoke:** `GET /parts/{id}/mesh` returns **200** with `content-type: model/stl` after sync + recompute

```bash
# After sync + recompute (replace IDs):
curl -s -X PUT "http://localhost:8080/sources/{source_id}/import-rules" \
  -H 'Content-Type: application/json' -d '{"rules":["STLs/"]}'
curl -s "http://localhost:8080/sources/{source_id}/import-rules"
curl -s -X PATCH "http://localhost:8080/parts/{part_id}" \
  -H 'Content-Type: application/json' -d '{"included":false}'
curl -s -o /dev/null -w "mesh:%{http_code}\n" "http://localhost:8080/parts/{part_id}/mesh"
```

## Review / checkoff

- [ ] Open plan review (`/plans/:id/review`)
- [ ] Toggle checkoff progress on a part unit

## Export

- [ ] Export STL pack job — download via `/exports/...`
- [ ] Export checklist HTML — thumbnails embedded when cached
- [ ] Export 3MF job

## Kit

- [ ] Import `.print-partner-kit.zip` via job or admin route

## Health

- [ ] `GET /health` shows `db.connected` and driver (`sqlite` or `postgres`)
