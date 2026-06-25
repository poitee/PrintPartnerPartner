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

## Tests

```bash
cd web
npm test
```

See [scripts/SMOKE_CHECKLIST.md](./scripts/SMOKE_CHECKLIST.md) for manual QA.

## Changelog

See [CHANGELOG.md](./CHANGELOG.md).
