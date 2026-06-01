# AGENTS.md

Guidance for AI agents working in this repository.

Print Partner is a **web platform**: a TypeScript monorepo under `web/` (a Vite + React SPA in `web/apps/web` and a Fastify API in `web/apps/server`, with shared packages in `web/packages/contracts` and `web/packages/domain`). The `Dockerfile` and Compose files live at the repository root. See `README.md` and `docs/ARCHITECTURE.md` for product context.

## Toolchain

- **Node 22** (matches the `node:22-bookworm-slim` Docker image).
- Run all Node commands from the `web/` directory.

## Develop, lint, and test

From `web/`:

```bash
npm ci          # install workspace deps
npm run dev     # Vite UI on :5173 + Fastify API on :18765 (hot reload)
npm run lint    # eslint .
npm run typecheck
npm test        # domain + web + server test suites
```

Tests live under `web/apps/*` and `web/packages/*` and use isolated temp data dirs — they do not touch any persistent volume. Use `PRINT_PARTNER_DATA_DIR=/path/to/dir` to keep dev data out of the default `./data` folder.

## Build & run via Docker

From the repository root:

```bash
docker compose up --build        # self-host: SQLite, app on http://localhost:8080
docker compose -f docker-compose.saas.yml up --build   # SaaS: Postgres + MinIO/S3 + OAuth
```

Health check: `GET /health` returns `{ ok: true, deploy_mode: "self-host" | "saas", ... }`.

The single container builds the SPA and runs the API with `STATIC_DIR` pointing at the built SPA, so both are served on one port. Data persists in the `print-partner-data` volume at `/data`.

## Deploy modes

`DEPLOY_MODE` selects the runtime adapter:

- **self-host** (default) — SQLite + local-disk storage.
- **saas** — Postgres (when `DATABASE_URL` is set) + S3-compatible blobs (when `S3_BUCKET` is set) + GitHub OAuth.

Exact env var names and defaults are in `web/apps/server/src/config.ts`; the full reference is in `web/DEPLOY.md`.

## Security scans

- Always run the `snyk_code_scan` tool for new first-party code generated in a Snyk-supported language.
- If security issues are found in newly introduced or modified code or dependencies, fix them using the Snyk results context, then rescan.
- Repeat until no new issues are found.
