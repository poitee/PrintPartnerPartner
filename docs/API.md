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
     -d '{"profile_id": 1}'
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

## Integrations (v1 only)

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/v1/integrations` | List connectors (secrets redacted) |
| `POST` | `/api/v1/integrations` | Create `{ type, name, config }` |
| `PATCH` | `/api/v1/integrations/:id` | Update name/config |
| `DELETE` | `/api/v1/integrations/:id` | Remove |
| `POST` | `/api/v1/integrations/:id/test` | Test connection (rate-limited) |
| `GET` | `/api/v1/integrations/:id/devices` | Device discovery |

**Moonraker** (reference adapter): set `config.base_url` to e.g. `http://192.168.1.50:7125`. Test calls `GET {base_url}/server/info`.

Stub adapters (`prusalink`, `bambu`, `spoolman`) return `{ ok: false, message: "…not implemented" }`.

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
