# Print Partner HTTP API

Self-host Docker serves the API on **http://localhost:8080**. The SPA uses flat routes such as `/plans` and `/jobs`. Automation and third-party tools use the versioned namespaces. Use `/api/v2` for the accepted Plan summary contract. Use `/api/v1` for other versioned routes.

## Discovery

| Endpoint | Description |
|----------|-------------|
| `GET /health` | Liveness, deploy mode, `api_version`, `capabilities` |
| `GET /api/v1` | API index: OpenAPI URL, docs, health |
| `GET /api/v1/openapi.json` | OpenAPI 3.1 document generated from Fastify routes that declare schema metadata (alias: `GET /openapi.json` → redirect). It is not a complete contract for every operational route. |
| `GET /api/v1/docs` | Swagger UI (dev / when `OPENAPI_UI=1`) |
| `GET /api/v2` | Plan API index |
| `GET /api/v2/openapi.json` | OpenAPI 3.1 alias. Only v2 Plan paths are registered. |

### Capabilities (health)

```json
{
  "ok": true,
  "api_version": "v1",
  "capabilities": ["kit_planning", "accepted_plate_revisions", "accepted_plate_export", "jobs_ws", "fleet_presets", "integrations_api"]
}
```

## Authentication (self-host)

When `PRINT_PARTNER_API_KEY` (or its `INTEGRATION_API_KEY` alias) is set,
`/api/v1/*` and `/api/v2/*` require a valid credential. Settings-created `ppk_…` keys are
accepted alongside the configured key:

- `Authorization: Bearer <key>`, or
- `X-Print-Partner-Api-Key: <key>`

An authenticated non-local session or configured Basic credentials can also
access the API. For direct self-host use only, a request whose actual socket
peer is loopback can access the API without a key when authentication and proxy
trust are both disabled and no forwarding headers are present. Browser-supplied
`Origin`, `Referer`, and `Sec-Fetch-*` headers never grant access.

Exempt paths include `/health`, both version indexes, both OpenAPI JSON paths,
and `/api/v1/docs`. Dotted API paths are not treated as static assets.

Supplying an invalid bearer or custom API key always returns `401`, including
from loopback. API keys currently have full authority; there is no role or scope
field in the API-key model. Treat every key as an administrator credential.

Administrative routes (backups, API-key settings, logging, integrations,
webhooks, and `/admin/*`) allow unambiguous loopback access, a valid API key,
configured Basic credentials, or an authenticated administrator session.
Non-admin sessions receive `403`.

### Reverse proxies

Set `TRUST_PROXY=1` only when running behind a controlled reverse proxy. Proxy
trust, required authentication, or forwarding headers disable the unauthenticated
loopback shortcut because the socket peer may be the proxy rather than the
original client. A reverse proxy deployment must therefore configure an API
key, Basic authentication, or multi-user authentication; never rely on the
proxy's loopback connection for authorization.

Flat routes (`/plans`, …) remain available for direct single-user SPA use.

## Errors

JSON errors use `{ "detail": "message" }` (optional `title`, `status`).

## Plan summaries

Flat Plan routes and `/api/v2/plans` return the accepted `ProfileSummary` contract. The `accepted_progress` field has one of these forms:

```json
{ "kind": "ready", "total_units": 12, "remaining_units": 3 }
{ "kind": "empty" }
{ "kind": "unavailable", "reason": "uninitialized" }
```

The unavailable reasons are `compatibility_dirty`, `uninitialized`, `integrity`, and `concurrent_update`. An unavailable Plan remains in a successful list response.

`/api/v1/plans` returns the legacy numeric fields `total_units` and `remaining_units` only when accepted Progress is ready or empty. A v1 list fails as one response when any Plan cannot supply accepted numeric totals. Integrity failures take precedence over other unavailable states.

`POST /api/v1/plans/:id/duplicate` returns `409` before writing:

```json
{ "detail": "Duplicate this Plan through /api/v2" }
```

## Accepted Plates

The first-party flat routes and `/api/v2` expose the same accepted Plate
workspace:

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/plans/:id/plates` | Read setup, ready, or blocked accepted Plate state |
| `POST` | `/plans/:id/plates/initialize` | Publish a complete explicit Printer allocation against an accepted Plan basis |
| `PATCH` | `/plans/:id/plates/:plateId/units/:token` | Move one Required unit using the expected Plate revision |

Accepted Plate mutations carry the complete accepted Plan basis and the
expected Plate revision. The server does not translate legacy match keys,
choose a Printer, rotate a mesh, or silently retry against a newer revision.

Accepted 3MF delivery uses the existing job transport:

```http
POST /api/v1/jobs/export-accepted-plate-3mf
Content-Type: application/json

{ "profile_id": 1, "expected_plate_revision_id": 17 }
```

The result contains tenant-scoped download URLs for the deterministic manifest,
bundle, and Plate files. It does not contain server filesystem paths.

This release intentionally removes the legacy `print-plan`, `print-groups`,
`print-assignments`, `plate-workspace`, `print-plan/prepare-missing`,
`pack-preview`, `export-3mf`, `auto-slice`, and `open-plates` routes from flat
and `/api/v1` registrations. These paths now return the framework's normal 404.
There is no match-key translator or 410 compatibility handler.

## Slicer / export poll flow

Typical automation (PrusaSlicer plugin, Orca script, folder watcher):

1. **Start export job**

   ```bash
   curl -X POST http://localhost:8080/api/v1/jobs/export-stl-pack \
     -H "Authorization: Bearer $PRINT_PARTNER_API_KEY" \
     -H "Content-Type: application/json" \
     -d '{"profile_id": 1, "group_by": "color_dir"}'
   ```

   Optional body fields:

   - `missing_only` (boolean, default `false`) — only export units not yet
     marked printed in checkoff.
   - `group_by` (string, default `"color_dir"`) — controls export folder layout:
     - `"color_dir"` — `role/<source directory>/file.stl` (keeps directories).
     - `"color"` — `role/file.stl` (flattens all directories into one folder per
       color/role; same-named files are de-duplicated with a directory prefix).

   STL bundle and checklist jobs read exactly one accepted Plan snapshot. The
   exported Parts, quantities, roles, unit completion, artifact identity, and
   thumbnail identity all come from that snapshot. Working Build edits do not
   affect these jobs until **Apply plan changes** succeeds.

   Start checklist and kit jobs through the same transport:

   ```http
   POST /api/v1/jobs/export-checklist-html
   { "profile_id": 1 }

   POST /api/v1/jobs/export-kit-bundle
   { "profile_id": 1, "include_print_progress": true }
   ```

   A kit job without `include_print_progress: true` remains an editable export
   of current working Parts. An explicit Progress export writes the complete
   accepted `parts` array and each Part's adjacent `print_units` from one
   accepted snapshot. The same rule applies to
   `POST /plans/:id/shares`.

   A successful non-empty accepted export can add `plan_version` and
   `revision_id` to the existing job result. If accepted state is unavailable,
   the job fails with this fixed message:

   ```text
   Accepted Plan state is unavailable. Apply or repair the Plan, then export again.
   ```

   Response: `{ "job_id": "…" }`

2. **Poll job status** (or use WebSocket `GET /ws/jobs/:id` on the flat path)

   ```bash
   curl "http://localhost:8080/api/v1/jobs/$JOB_ID"
   ```

   Wait until `status` is `done` or `error`.

   Alternative — list recent completed jobs:

   ```bash
   curl "http://localhost:8080/api/v1/jobs?status=done&since=2026-06-01T00:00:00Z"
   ```

3. **Download artifact**

   From job `result.download_url` (e.g. `/exports/…`):

   ```bash
   curl -O "http://localhost:8080${DOWNLOAD_URL}"
   ```

4. **List plan artifacts** (recent exports for a plan)

   ```bash
   curl "http://localhost:8080/api/v1/plans/1/artifacts"
   ```

## Printer fleet & slicer profile assignment (flat routes)

Settings → Printers uses these same-origin routes (not under `/api/v1`):

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/printers` | Fleet bed metadata + filament slots |
| `GET` | `/slicer-profile-options` | Compact machine / filament / process lists for profile pickers |
| `GET` | `/printers/:id/profile-assignment` | Assigned machine + slot filaments, compatible processes, last synced |
| `PUT` | `/printers/:id/profile-assignment` | Save `{ profile_source, machine_profile_id, filament_slots }` |

`profile_source` is `assigned` or `auto_match`. These fields retain imported
profile preferences for slicer setup and future integrations. Accepted Plate
export and handoff do not choose machine, process, or filament profiles.

The Export **Profile library** panel was removed; sync status and assignments live on Settings → Printers.

## Slicer instances (Slicer Hub)

Settings → Slicers registers GUI URLs and profile watch paths (schema v15). Startup seeds stock Orca/Prusa/Bambu rows when the table is empty. Profile-sync prefers enabled instance watch paths; Export “Open a slicer” uses enabled `gui_url` values (falls back to hardcoded links if none).

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/slicer-instances` | List instances |
| `POST` | `/slicer-instances` | Create `{ name, kind, dialect?, gui_url?, watch_path?, enabled? }` |
| `PUT` | `/slicer-instances/:id` | Update fields |
| `DELETE` | `/slicer-instances/:id` | Remove (204) |
| `POST` | `/slicer-instances/seed-defaults` | Insert stock presets if empty |

`kind`: `orca` \| `prusa` \| `bambu` \| `custom`. `dialect`: `orca_json` \| `bambu_json` \| `prusa_ini`. Custom + enabled requires `watch_path`.

### Docker lifecycle (self-host)

Containers must carry label `printpartner.slicer_instance_id=<instance id>`. SaaS returns **403**.

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/slicer-instances/:id/docker-status` | Refresh + persist `status_cache` |
| `POST` | `/slicer-instances/:id/docker-pull` | Pull image |
| `POST` | `/slicer-instances/:id/docker-start` | Create/start labeled container |
| `POST` | `/slicer-instances/:id/docker-stop` | Stop labeled container |
| `GET` | `/slicer-instances/:id/docker-logs?tail=200` | Bounded log tail |

### Export plate → slicer handoff

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/slicer-handoff/exchange-status` | Whether `PP_EXCHANGE_DIR` is writable |
| `POST` | `/slicer-instances/:id/open-accepted-plates` | Stage one requested accepted Plate revision into the exchange inbox |

Body: `{ profile_id, expected_plate_revision_id }`. The handoff uses the same
verified files as accepted export and returns only relative or tenant-scoped
locations. Managed open requires a writable exchange directory; otherwise use
the accepted Plate download.

## Integrations (v1 only)

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/v1/integrations` | List connectors (secrets redacted) |
| `POST` | `/api/v1/integrations` | Create `{ type, name, config }` |
| `PATCH` | `/api/v1/integrations/:id` | Update name/config |
| `DELETE` | `/api/v1/integrations/:id` | Remove |
| `POST` | `/api/v1/integrations/:id/test` | Test connection (rate-limited) |
| `GET` | `/api/v1/integrations/:id/devices` | Device discovery |
| `GET` | `/api/v1/integrations/:id/status` | Live printer host status (`getStatus`; states include `complete`) |
| `GET` | `/api/v1/printer-checkoff` | List durable job↔Progress unit mappings (`?state=watching\|awaiting_verify`) |
| `POST` | `/api/v1/printer-checkoff/reconcile` | Fetch live host status; queue verify or mark host_failed (`{ integration_id }`) |
| `POST` | `/api/v1/printer-checkoff/verify` | Confirm/reject awaiting units (`{ link_id, decisions }`) |
| `POST` | `/api/v1/printer-checkoff/dismiss` | Dismiss a `host_failed` link |
| `GET` | `/api/v1/printer-outcomes/summary` | Reject/confirm aggregates (`?profile_id=`) |
| `GET` | `/api/v1/printer-send-queue` | List send queue (`?active=1`) |
| `POST` | `/api/v1/printer-send-queue` | Enqueue G-code for Idle dispatch (multipart; optional `match=compatible`) |
| `POST` | `/api/v1/printer-send-queue/:id/dispatch` | Dispatch one item (`force` skips Idle wait) |
| `POST` | `/api/v1/printer-send-queue/drain` | Dispatch ready queued items to Idle printers |
| `DELETE` | `/api/v1/printer-send-queue/:id` | Cancel a queued/error item |
| `POST` | `/bambu-connect/handoff` | Stage `.3mf`/`.gcode` and return official `bambu-connect://import-file` URL (optional OS launch; SPA flat route) |
| `GET` | `/bambu-connect/handoff/:id/file` | Download staged Connect handoff file |

**Moonraker** (reference adapter): set `config.base_url` to e.g. `http://192.168.1.50:7125`. Test calls `GET {base_url}/server/info`.

**Spoolman** (filament inventory): set `config.base_url` to e.g. `http://192.168.1.50:7912` (no `/api/v1`). Test tries `GET {base}/api/v1/info` then `/health`. Proxy routes:

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/v1/integrations/:id/spoolman/filaments` | Filament catalog for Build picker |
| `GET` | `/api/v1/integrations/:id/spoolman/spools` | Spool inventory (remaining weight) |

`GET /filaments/catalog` includes `spoolman_colors` when `default_spoolman_integration_id` is set (Settings) or when `?spoolman_integration_id=` is passed. User guide: [integrations/SPOOLMAN.md](integrations/SPOOLMAN.md).

Moonraker and PrusaLink support test, status, upload, and Checkoff verify-first. Bambu supports LAN MQTT status plus **Connect URL handoff** (not MQTT print-start). Setup: [integrations/PRINTER_SETUP.md](integrations/PRINTER_SETUP.md).

**MCP attach (preferred):** streamable HTTP at `/api/v1/mcp` with `PRINT_PARTNER_API_KEY`. There is **no in-app Kit Advisor** and **no Settings → AI**. Guide: [assistant-mcp.md](assistant-mcp.md), [KIT_ADVISOR.md](KIT_ADVISOR.md).

Legacy `/assistant/*` routes may still exist for tooling/history; chat UX is external via MCP. Prefer MCP for new integrations.

## Assistant / MCP-related routes (`/assistant/*`)

Flat routes (same handlers also appear under `/api/v1` where mounted). Full schemas: OpenAPI (`GET /api/v1/openapi.json`) when available. Primary product surface for agents is **`/api/v1/mcp`**, not in-app chat.

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/assistant/status` | Enabled?, provider, model, tools, budgets (no secrets) |
| `POST` | `/assistant/actions/apply` | Confirm a proposed action |
| `POST` | `/assistant/actions/dismiss` | Dismiss a proposed action |
| `GET` / `DELETE` | `/assistant/history` | Per-tenant history |
| `GET` / `DELETE` | `/assistant/decisions` | Decision memory (`?plan_id=` or `?all=true`) |
| `GET` / `POST` / `DELETE` | `/assistant/feedback` | Thumbs ranking (not training) |
| `GET` | `/assistant/preferences` | Debug digest (`?plan_id=`) |
| `GET` | `/assistant/domain` | Loaded domain research pack summary |
| `POST` | `/assistant/domain/import` | Import / backfill domain packs |

Mutations never auto-apply — clients must call `actions/apply` / MCP `confirm_apply`. Operator env + MCP: [`web/DEPLOY.md`](../web/DEPLOY.md).

## Webhooks (optional)

Register a URL to receive POST JSON on `job.done` / `job.error`:

```bash
curl -X POST http://localhost:8080/api/v1/webhooks \
  -H "Authorization: Bearer $PRINT_PARTNER_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"url":"http://host.docker.internal:9999/hook","events":["job.done"]}'
```

## Docker checklist

```bash
docker compose up --build

curl http://localhost:8080/health
curl http://localhost:8080/api/v1
curl -H "Authorization: Bearer $PRINT_PARTNER_API_KEY" http://localhost:8080/api/v1/plans
curl -H "Authorization: Bearer $PRINT_PARTNER_API_KEY" http://localhost:8080/api/v2/plans
```

## Route layout

- **Flat** — SPA routes, including the accepted Plan summary contract at `/plans`
- **`/api/v1`** — Legacy numeric Plan summaries plus integrations, webhooks, the job list, and Plan artifacts
- **`/api/v2`** — Plan routes with the accepted `ProfileSummary` contract

Flat and v2 Plan responses use the same contract. V1 Plan responses use the legacy presenter described above.
