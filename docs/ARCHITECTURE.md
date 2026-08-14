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

STL previews and the on-scroll Checkoff thumbnails are rendered **client-side with Three.js** in the React SPA — there is no server-side mesh renderer. The browser downloads STL geometry from the API and rasterizes previews locally.

## HTTP API & integrations

- **Versioned surface:** `GET /api/v1` with OpenAPI at `/api/v1/openapi.json` (legacy flat routes remain for the SPA).
- **Automation auth (self-host):** optional `PRINT_PARTNER_API_KEY` for `/api/v1/*`.
- **Integrations:** pluggable adapters under `/api/v1/integrations` (Moonraker test connection first; other vendors stubbed).
- **Fleet presets:** `/printers` bed metadata for 3MF packing — separate from live printer hosts.
- **Live printer hosts:** Moonraker and PrusaLink support status + G-code upload with verify-first Progress; Bambu LAN MQTT is status-only. Setup: [integrations/PRINTER_SETUP.md](./integrations/PRINTER_SETUP.md); research/UX: [integrations/PRINTER_APIS.md](./integrations/PRINTER_APIS.md), [integrations/PRINTER_UX.md](./integrations/PRINTER_UX.md).

See [API.md](./API.md) for slicer polling, exports, and webhooks.

```mermaid
flowchart LR
  Clients[External clients] --> V1["/api/v1"]
  SPA[React SPA] --> Flat["/plans /jobs …"]
  V1 --> Core[Core routes]
  Flat --> Core
  V1 --> Integrations[integrations adapters]
```

## Background jobs & progress

Long-running work — repo sync, plan recompute, STL pack export, HTML checklist export, and kit-bundle import/export — runs through a background **job runner** (`web/apps/server/src/routes/jobs.ts`). Self-host and SaaS both use the in-process runner by default; SaaS can be backed by a BullMQ/Redis queue (`REDIS_URL`) for horizontal scaling. Clients start a job over REST and subscribe to live progress via the WebSocket at `/ws/jobs/:id`.

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
4. **Progress** — per-unit progress (saved per plan), printable checklist, and missing-STL export.
5. **Export** — STL packs, share bundles, checklist HTML, 3MF, and printer send.

Plan switching lives in the spine **PlanPicker**; create/rename/duplicate/delete open from Create plan or the Plan page overflow menu. The active plan is shared across Plan, Parts, Progress, and Export.

## Kit advisor (assistant as tool host)

Print Partner hosts MCP-shaped **product-verb tools** for the kit advisor LLM. The chat loop in `web/apps/server/src/assistant/` exposes read tools and confirm-to-apply mutate tools; the SPA renders Apply cards (including editable `suggested_excludes`). A thin **stdio MCP server** (`npm run mcp -w @print-partner/server`) reuses the same tool implementations for external hosts — see [`web/DEPLOY.md`](../web/DEPLOY.md).

```mermaid
flowchart LR
  Chat[Chat / LLM] --> Tools[Assistant tools]
  Tools --> Graph[Interaction graph]
  Tools --> Catalog[kit-catalog]
  Tools --> Domain[assistant-domain]
  Tools --> Sources[Sources + sync]
  Tools --> Plan[Plan layers]
  Tools -->|"safeOutboundFetch"| Web[Guide URLs]
  Research[web_search / fetch_web_page / read_source_file] --> Synth[Synthesize]
  Synth --> Cards[Decision / Apply cards]
  Chat --> Research
  Chat --> Prompt[System prompt]
  Prompt --> PlanCtx[Dynamic plan-context block]
```

- **Research loop**: read tools (`web_search`, `fetch_web_page`, `read_source_file`, plus catalog/docs tools) gather untrusted evidence; the model synthesizes options, then emits decision / Apply cards (`update_kit_selections`, `ui_focus_kit_option`, etc.). Nothing mutates until the user confirms.
- **Plan context**: every chat turn injects a dynamic plan snapshot into the system prompt (`## Active plan snapshot` — layers, kit selections, stale flag) via `summarizePlan` in `assistant/assistant-context.ts`, alongside preferences digests and domain packs.
- **Interaction graph** (`services/interaction-graph.ts`) merges domain `compatibility.yaml`, catalog `pick_one` / `replaces_slot`, and `_global/merge_conflicts.yaml`. Tools: `get_interaction_graph`, `check_stack_compatibility`. Soft warnings also appear on `add_addon` / `apply_stack_preset` proposes and in plan Review (`compat_*` issue codes).
- **URL ingest**: `ingest_guide_url` / `ingest_guide_text` return untrusted `GuideExtract` evidence (heuristic extract, optional LLM refine when the assistant is configured); `propose_add_source` / `import_guide_notes` / `propose_exclude_replaced_parts` close the loop behind Apply. Confirmed `suggested_excludes` on `add_addon` / `apply_stack_preset` Apply cards merge into kit-manifest exclude.
- **Link → build pipeline**: applying `propose_add_source` for a syncable source returns a **Sync → Update** follow-up card (same `sync_then_recompute` workflow as `set_base` / `set_source_git_ref`). `inspect_repo_tree` previews a GitHub repo's folders/STL counts pre-sync (tree listing only, `services/repo-tree-summary.ts` + `fetchGithubRepoTreeSummary`); `detect_build_decisions` (`assistant/build-decisions.ts`) turns variant-looking folders + README extract into a decision list (variant / optional_mod / config, heuristic first with a guarded LLM refine) the advisor walks one at a time into `update_kit_selections` / `ui_focus_kit_option`. Repos without manifest YAML or path-hints get sibling-folder fallback option groups in `plan-manifest-builder.ts` so Build pickers appear (e.g. EMU `User_Mods/`, `(Option)` folders).
- Domain packs under `assistant-domain/` remain runtime context (not training). See [assistant-domain-ingest-schema.md](./assistant-domain-ingest-schema.md).
- **Decision memory**: Apply/Dismiss write `plan_decisions`; thumbs write `assistant_feedback`. Digests (prefer/avoid, notes, cross-plan patterns, high-confidence thumbs scores) inject into the system prompt every turn. Sync/recompute noise is omitted from Prefer/Avoid unless it is the only signal. Dismissed action fingerprints are hard-filtered on tool propose and soft stack suggest. This is runtime ranking/context only — **no fine-tuning**. Clear chat history does not clear decisions/feedback; use kit advisor **Clear decisions** / **Clear thumbs**, or `DELETE /assistant/decisions?plan_id=` / `?all=true` and `DELETE /assistant/feedback`. Operators can inspect the digest via self-host `GET /assistant/preferences?plan_id=`.

## Deploy modes at a glance

| Mode | App DB | Files | Auth |
|------|--------|-------|------|
| **self-host** | SQLite under `PRINT_PARTNER_DATA_DIR` | Local disk | Optional HTTP Basic |
| **saas** | Postgres (tenant-scoped) | `SAAS_DATA_DIR` or S3 | GitHub OAuth / Basic / dev anonymous |

See [`../web/DEPLOY.md`](../web/DEPLOY.md) for environment variables and Docker Compose details.
