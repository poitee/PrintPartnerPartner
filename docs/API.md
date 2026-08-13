# Print Partner HTTP API

Self-host Docker serves the API on **http://localhost:8080**. The SPA continues to use flat routes (`/plans`, `/jobs`, …); automation and third-party tools should use the versioned namespace **`/api/v1`**.

## Discovery

| Endpoint | Description |
|----------|-------------|
| `GET /health` | Liveness, deploy mode, `api_version`, `capabilities` |
| `GET /api/v1` | API index: OpenAPI URL, docs, health |
| `GET /api/v1/openapi.json` | OpenAPI 3.1 spec (alias: `GET /openapi.json` → redirect) |
| `GET /api/v1/docs` | Swagger UI (dev / when `OPENAPI_UI=1`) |

### Capabilities (health)

```json
{
  "ok": true,
  "api_version": "v1",
  "capabilities": ["kit_planning", "jobs_ws", "fleet_presets", "integrations_api"]
}
```

## Authentication (self-host)

When `PRINT_PARTNER_API_KEY` is set, `/api/v1/*` requires either:

- `Authorization: Bearer <key>`, or
- `X-Print-Partner-Api-Key: <key>`

Exempt paths: `/health`, `/api/v1/openapi.json`, `/api/v1/docs`, static SPA assets.

Flat routes (`/plans`, …) remain unauthenticated for same-origin SPA use.

## Errors

JSON errors use `{ "detail": "message" }` (optional `title`, `status`).

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

**Moonraker** (reference adapter): set `config.base_url` to e.g. `http://192.168.1.50:7125`. Test calls `GET {base_url}/server/info`.

**Spoolman** (filament inventory): set `config.base_url` to e.g. `http://192.168.1.50:7912` (no `/api/v1`). Test tries `GET {base}/api/v1/info` then `/health`. Proxy routes:

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/v1/integrations/:id/spoolman/filaments` | Filament catalog for Build picker |
| `GET` | `/api/v1/integrations/:id/spoolman/spools` | Spool inventory (remaining weight) |

`GET /filaments/catalog` includes `spoolman_colors` when `default_spoolman_integration_id` is set (Settings) or when `?spoolman_integration_id=` is passed. User guide: [integrations/SPOOLMAN.md](integrations/SPOOLMAN.md).

Stub adapter (`bambu`) returns not-implemented for send; Moonraker and PrusaLink support test, status, upload, and Progress verify-first checkoff (desk-v1 self-host). Setup: [integrations/PRINTER_SETUP.md](integrations/PRINTER_SETUP.md). Research: [integrations/PRINTER_APIS.md](integrations/PRINTER_APIS.md).

**AI assistant (`ai_assistant` integration):** create/update via the integrations API (or **Settings → AI assistant**). Config fields include `provider`, `model`, `api_key`, `base_url` / `ollama_url`, `max_tokens`, budgets, `search_provider`, `search_api_key`, `allow_url_ingest`, `guide_ingest_max_bytes`, `ollama_num_ctx`. Secrets are redacted in list responses. User guide: [KIT_ADVISOR.md](KIT_ADVISOR.md).

## Kit advisor (`/assistant/*`)

Flat routes (same handlers also appear under `/api/v1` where mounted). Full schemas: OpenAPI (`GET /api/v1/openapi.json`) when available.

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/assistant/status` | Enabled?, provider, model, `source` (`settings` \| `env` \| `none`), tools, budgets used/cap, search status (no secrets) |
| `POST` | `/assistant/chat` | Chat turn (SSE/stream); may propose Apply cards. Soft daily budgets → `429` |
| `POST` | `/assistant/actions/apply` | Confirm a proposed action |
| `POST` | `/assistant/actions/dismiss` | Dismiss a proposed action |
| `GET` / `DELETE` | `/assistant/history` | Per-tenant chat history |
| `GET` / `DELETE` | `/assistant/decisions` | Decision memory (`?plan_id=` or `?all=true`) |
| `GET` / `POST` / `DELETE` | `/assistant/feedback` | Thumbs up/down ranking (not training) |
| `GET` | `/assistant/preferences` | Debug digest used in the system prompt (`?plan_id=`) |
| `GET` | `/assistant/domain` | Loaded domain research pack summary |
| `POST` | `/assistant/domain/import` | Import / backfill domain packs |

Mutations never auto-apply — clients must call `actions/apply`. Operator env + MCP: [`web/DEPLOY.md`](../web/DEPLOY.md).

## Webhooks (optional)

Register a URL to receive POST JSON on `job.done` / `job.error`:

```bash
curl -X POST http://localhost:8080/api/v1/webhooks \
  -H "Content-Type: application/json" \
  -d '{"url":"http://host.docker.internal:9999/hook","events":["job.done"]}'
```

## Docker checklist

```bash
docker compose up --build

curl http://localhost:8080/health
curl http://localhost:8080/api/v1
curl -H "Authorization: Bearer $PRINT_PARTNER_API_KEY" http://localhost:8080/api/v1/plans
```

## Route layout

- **Flat** — SPA compatibility: `/plans`, `/jobs`, `/exports`, `/ws/jobs/:id`, …
- **`/api/v1`** — Same kit-planning routes plus integrations, webhooks, job list, plan artifacts

Both mounts share the same handlers; responses are identical for shared paths.
