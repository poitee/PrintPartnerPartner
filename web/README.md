# Print Partner — Web Platform

TypeScript monorepo for the browser-hosted Print Partner.

## Layout

| Package | Path | Role |
|---------|------|------|
| `@print-partner/web` | `apps/web` | Vite + React SPA |
| `@print-partner/server` | `apps/server` | Fastify API |
| `@print-partner/contracts` | `packages/contracts` | Shared API types |
| `@print-partner/domain` | `packages/domain` | Domain logic ported from Python |

## Quick start

```bash
cd web
npm install
npm run dev
```

- **API** `http://127.0.0.1:18765` (`/health`)
- **UI** `http://127.0.0.1:5173`

## Deploy modes

| Mode | App DB | Files | Auth |
|------|--------|-------|------|
| **self-host** | SQLite under `PRINT_PARTNER_DATA_DIR` | Local disk | Optional Basic |
| **saas** + `DATABASE_URL` | Postgres (tenant-scoped) | `SAAS_DATA_DIR` or S3 | OAuth / Basic / dev anonymous |

See [DEPLOY.md](./DEPLOY.md) for Docker Compose and env vars.

## Feature parity vs desktop

| Area | Web v1 | Desktop |
|------|--------|---------|
| Sources (GitHub, local, zip) | Yes | Yes |
| Plans, layers, recompute, manifest apply | Yes | Yes |
| Stack presets (kit catalog) | Yes | Yes |
| Review / checkoff / role filaments | Yes | Yes |
| STL pack, HTML checklist, 3MF export | Yes | Yes |
| Kit bundle import/export | Yes | Yes |
| Print plan / plate workspace | Yes | Yes |
| Repo manifest builder | Yes | Yes |
| Custom filaments | Yes (JSON store) | Yes |
| Postgres multi-tenant (SaaS) | Yes | N/A |
| PyVista 3D preview | Client only | Native |
| Printables / MakerWorld | 501 stub | Limited |
| lib3mf / system git | Not used | Used |

## Tests

```bash
cd web
npm test
```

Current suite: **57 tests** (domain + server). See [scripts/SMOKE_CHECKLIST.md](./scripts/SMOKE_CHECKLIST.md) for manual QA.

## Changelog

See [CHANGELOG.md](./CHANGELOG.md).
