# Print Partner architecture

Kit planning for the web: sync STL repositories, compose layered plans, export STLs by role/folder, and check off prints — served as a single container you can self-host, with an optional multi-tenant SaaS mode.

## Overview

Print Partner is a TypeScript monorepo under `web/`:

| Package | Path | Role |
|---------|------|------|
| `@print-partner/web` | `web/apps/web` | Vite + React single-page app |
| `@print-partner/server` | `web/apps/server` | Fastify API; also serves the SPA in single-port mode |
| `@print-partner/contracts` | `web/packages/contracts` | Shared API types |
| `@print-partner/domain` | `web/packages/domain` | Framework-agnostic domain logic |

In production the Fastify server serves both the API and the built React SPA on **one port**. When `STATIC_DIR` is set, `@fastify/static` serves the SPA from that directory and a not-found handler falls back to `index.html` for client-side routes (`web/apps/server/src/app.ts`). In local dev the two run separately: Vite UI on `:5173`, API on `:18765`.

```mermaid
flowchart LR
  Browser["React SPA (Three.js previews)"] -->|REST + WebSocket| API["Fastify API"]
  API --> Ports["Ports (db / storage / repoSource / auth / jobs)"]
  Ports --> SelfHost["self-host adapter: SQLite + local disk"]
  Ports --> Saas["saas adapter: Postgres + S3"]
  API --> Jobs["Background job runner"]
  Jobs -->|progress| WS["/ws/jobs/:id"]
```

## Single-port serving

- Built SPA assets are served from `STATIC_DIR` (the Docker image sets it to `/app/web/apps/web/dist`).
- API routes (`/sources`, `/plans`, `/parts`, `/jobs`, `/exports`, `/settings`, `/auth`, …) are registered on the same Fastify instance.
- The not-found handler returns `index.html` for extension-less `GET` requests so deep links resolve to the SPA; everything else returns a JSON 404.

## Ports / adapters

The server is built around a small set of ports (`web/apps/server/src/ports/index.ts`): `DbStore`, `StoragePort`, `RepoSource`, `AuthProvider`, and `JobRunner`. `createPorts(config)` in `app.ts` selects an adapter by `DEPLOY_MODE`:

| Concern | self-host (`web/apps/server/src/adapters/self-host`) | saas (`web/apps/server/src/adapters/saas`) |
|---------|------------------------------------------------------|--------------------------------------------|
| App data | SQLite under the data dir | Postgres when `DATABASE_URL` is set, else SQLite fallback |
| Blob storage | Local disk (`SelfHostStoragePort`) | S3-compatible when `S3_BUCKET` is set, else tenant-scoped local disk |
| Tenancy | Single `"default"` tenant | Per-request tenant resolution (header / OAuth / dev anonymous) |
| Auth | None (optional HTTP Basic at the edge) | GitHub OAuth, HTTP Basic, or `SAAS_ALLOW_ANONYMOUS` for dev |

Both adapters expose the same repository API, so routes are written once against `AppRepository` regardless of deploy mode. In SaaS, `repositoryForTenant` returns a tenant-scoped repository; in self-host there is a single shared repository.

## Data layer (Drizzle ORM)

Persistence uses **Drizzle ORM** with two backends selected at startup (`web/apps/server/src/db/database.ts`):

- **SQLite** (`schema.ts`, `client.ts`) — the default for self-host; the database file and synced repos live under `PRINT_PARTNER_DATA_DIR` (`/data` in Docker).
- **Postgres** (`schema-pg.ts`, `client-postgres.ts`) — used in SaaS when `DATABASE_URL` is set; rows are tenant-scoped and migrations run on startup.

File blobs (synced repos, exports, thumbnails) are stored on disk in self-host, and on disk or S3 in SaaS.

## Client rendering

STL previews and Progress thumbnails are rendered **client-side with Three.js** in the React SPA — there is no server-side mesh renderer. The browser downloads STL geometry from the API and rasterizes previews locally. The SPA keeps a small **IndexedDB mesh cache**, decimates heavy meshes for thumbs, and limits concurrent WebGL work so scrolling Progress stays responsive.

## HTTP API & integrations

- **Versioned surface:** `GET /api/v1` with OpenAPI at `/api/v1/openapi.json` (legacy flat routes remain for the SPA).
- **Automation auth (self-host):** optional `PRINT_PARTNER_API_KEY` for `/api/v1/*`.
- **Integrations:** pluggable adapters under `/api/v1/integrations` (Moonraker, PrusaLink, Bambu status, Spoolman, slicer sidecar, Discord, Home Assistant).
- **Fleet presets:** `/printers` bed metadata for 3MF packing — separate from live printer hosts.
- **Live printer hosts:** Moonraker and PrusaLink support status + G-code upload with verify-first Progress; Bambu LAN MQTT is status-only. Setup: [integrations/PRINTER_SETUP.md](./integrations/PRINTER_SETUP.md); research/UX: [integrations/PRINTER_APIS.md](./integrations/PRINTER_APIS.md), [integrations/PRINTER_UX.md](./integrations/PRINTER_UX.md).
- **Ops endpoints:** backups, API key CRUD, logging export, `/metrics`, and rate limits — see [`../OPERATIONS.md`](../OPERATIONS.md).

See [API.md](./API.md) for slicer polling, exports, and webhooks.

```mermaid
flowchart LR
  Clients[External clients] --> V1["/api/v1"]
  SPA[React SPA] --> Flat["/plans /jobs …"]
  V1 --> Core[Core routes]
  Flat --> Core
  V1 --> Integrations[integrations adapters]
  V1 --> MCP["/api/v1/mcp"]
```

## Background jobs & progress

Long-running work — repo sync, plan recompute, STL pack export, HTML checklist export, kit-bundle import/export, and auto-slice — runs through a background **job runner** (`web/apps/server/src/routes/jobs.ts`). Self-host and SaaS both use the in-process runner by default; SaaS can be backed by a BullMQ/Redis queue (`REDIS_URL`) for horizontal scaling. Clients start a job over REST and subscribe to live progress via the WebSocket at `/ws/jobs/:id`.

## Workflow

```mermaid
flowchart LR
  Library[Library] --> Plan[Plan]
  Plan --> Parts[Parts]
  Parts --> Progress[Progress]
  Progress --> Export[Export]
  Library -->|sync| DB[(App DB)]
  Plan -->|recompute| DB
  Export -->|export STLs| FS[exports/]
  Progress -->|progress| DB
```

1. **Library** — register GitHub/local/zip sources; categories; import rules; cross-repo STL search; update-available badges.
2. **Plan** — set role filament colors, attach sources, pick files and quantities, rebuild plan; inline repo Docs viewer; kit/manifest options.
3. **Parts** — validation summary by role/filament; full parts list with 3D previews.
4. **Progress** — per-unit progress (saved per plan), assembled toggles, printable checklist, and missing-STL export.
5. **Export** — plate workspace, height bands, slicer links, STL packs, share bundles, checklist HTML, 3MF, and printer send. Slicer profile assignment and sync status live on **Settings → Printers** (not a flat profile library on Export). **Settings → Slicers** registers slicer instances (GUI URL + watch path + dialect); profile-sync and Export slicer links follow enabled instances. Self-host Docker pull/start/stop/logs operate only on containers labeled `printpartner.slicer_instance_id`.

Plan switching lives in the spine **PlanPicker**; create/rename/duplicate/archive open from **Create plan** or the **Plans** page. The active plan is shared across Plan, Parts, Progress, and Export. Settings: **Printers / Slicers / Library / Appearance / Account**.

## MCP attach (kit brain)

Print Partner exposes MCP-shaped **product-verb tools** over streamable HTTP at `/api/v1/mcp` (and optionally a thin stdio MCP server for offline `DATA_DIR` copies). Attach **Cursor / Grok / Claude** — there is **no in-app kit advisor chat** and **no Settings → AI**. Mutations only **propose**; apply with `confirm_apply`. See [assistant-mcp.md](./assistant-mcp.md) and [KIT_ADVISOR.md](./KIT_ADVISOR.md).

```mermaid
flowchart LR
  Agent[Cursor / Grok / Claude] --> MCP["/api/v1/mcp"]
  MCP --> Tools[Product tools]
  Tools --> Sources[Sources + sync]
  Tools --> Plan[Plan layers]
  Tools --> Farm[Farm / print stats]
  Tools -->|"confirm_apply"| DB[(App DB)]
```

- **Confirm-to-apply**: mutating tools write proposals; nothing changes until confirm/dismiss.
- **Domain packs** under `assistant-domain/` remain runtime context (not training). See [assistant-domain-ingest-schema.md](./assistant-domain-ingest-schema.md).
- **Decision memory**: Apply/Dismiss write `plan_decisions`; feedback writes `assistant_feedback`. This is ranking/context only — **no fine-tuning**.

## Schema dialects

Self-host defaults to **SQLite** (`schema.ts`, version stamped after DDL). SaaS uses **Postgres** (`schema-pg.ts` + `postgresPostInitMigrations`) with the same `schema_version`. Profile-sync provenance columns (v13) and farm/print_jobs columns (v11–v12) must exist on both dialects.

| Mode | App DB | Files | Auth |
|------|--------|-------|------|
| **self-host** | SQLite under `PRINT_PARTNER_DATA_DIR` | Local disk | Optional HTTP Basic |
| **saas** | Postgres (tenant-scoped) | `SAAS_DATA_DIR` or S3 | GitHub OAuth / Basic / dev anonymous |

See [`../web/DEPLOY.md`](../web/DEPLOY.md) for environment variables and Docker Compose details.
