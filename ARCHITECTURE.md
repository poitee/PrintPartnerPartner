# Print Partner Architecture

Canonical architecture for today’s product lives in **[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)** (desk loop, MCP attach, schema dialects, jobs, integrations).

This root file remains as an ops-oriented companion covering monitoring, security posture, and deployment considerations. Prefer `docs/ARCHITECTURE.md` for system design and `OPERATIONS.md` for day-two procedures.

## Overview

Print Partner is a self-hosted desk workflow for layered STL kits:

- **Frontend**: React + TypeScript SPA (Vite)
- **Backend**: Fastify + TypeScript API server
- **Database**: SQLite (supported self-host) or experimental PostgreSQL (SaaS)
- **Deployment**: Docker Compose on port **8080** (LAN box friendly)

**Desk loop:** Library → Builds → Sources → Plan → Checkoff → Production. Global Production, Printers, Settings, and Help sit in utility nav. Kit brain is **HTTP MCP attach** (no in-app Kit Advisor).

## Directory structure (abridged)

```text
PrintPartnerPartner/
├── Dockerfile / docker-compose*.yml / pp-compose.yml
├── slicer-sidecar/              # Waitress + Orca CLI companion
├── docs/                        # INSTALL, ARCHITECTURE, Pages, MCP
├── OPERATIONS.md                # Backups, API keys, metrics
└── web/                         # Monorepo (apps/web, apps/server, packages)
```

## Schema dialects

SQLite and Postgres stamp the same `schema_version` after applying matching DDL (including profile-sync provenance v13 and print_jobs farm columns). See `web/apps/server/src/db/schema.ts`, `schema-pg.ts`, and `client-postgres.ts`.

## Client STL thumbnails

Progress/Parts thumbs render in-browser with Three.js. The SPA uses an IndexedDB mesh cache, decimation for thumbs, concurrency limits, and retry — no server-side mesh renderer.

## Further reading

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — system design
- [`OPERATIONS.md`](OPERATIONS.md) — backups, keys, metrics, troubleshooting
- [`SECURITY.md`](SECURITY.md) — webhooks, SSRF, auth
- [`NON_ROOT_SETUP.md`](NON_ROOT_SETUP.md) — non-root container notes
- [`DATABASE_OPTIMIZATION.md`](DATABASE_OPTIMIZATION.md) — indexing / query notes
