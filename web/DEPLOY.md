# Deploying Print Partner Web

## Self-host (default)

### Docker Compose

From the repository root:

```bash
docker compose up --build
```

Open [http://localhost:8080](http://localhost:8080). Data persists in the `print-partner-data` volume (`/data` in the container).

### Environment variables (self-host)

| Variable | Default | Description |
|----------|---------|-------------|
| `PRINT_PARTNER_DATA_DIR` | `./data` | SQLite DB, repos, exports, thumbs |
| `HOST` | `127.0.0.1` | Bind address |
| `PORT` | `18765` (dev) / `8080` (Docker) | HTTP port |
| `STATIC_DIR` | unset | When set, serve built SPA from this directory |
| `DEPLOY_MODE` | `self-host` | `self-host` or `saas` |
| `CORS_ORIGIN` / `ALLOWED_ORIGINS` | `true` | CORS allowed origin(s); comma-separated list for multiple |
| `PP_VERSION` | `0.1.0-web` | Health payload version |
| `BASIC_AUTH_USER` / `BASIC_AUTH_PASS` | unset | Optional HTTP Basic protection |
| `UPLOAD_MAX_BYTES` | `536870912` | Multipart upload limit (512 MiB) |
| `PRINT_PARTNER_API_KEY` | unset | When set (self-host), requires Bearer or `X-Print-Partner-Api-Key` on `/api/v1/*` |
| `OPENAPI_UI` | unset | Set to `1` to expose `/api/v1/docs` in production |
| `REDIS_URL` | unset | Optional; when set in SaaS, enables BullMQ job queue (see SaaS) |

### Local development

```bash
cd web
npm ci
npm run dev
```

API: `http://127.0.0.1:18765` · Vite UI: `http://127.0.0.1:5173`

Versioned API for integrations: `http://127.0.0.1:18765/api/v1` — see [`../docs/API.md`](../docs/API.md).

## SaaS mode (`DEPLOY_MODE=saas`)

SaaS mode uses **Postgres for app data** when `DATABASE_URL` is set (tenant-scoped rows). File blobs (repos, exports, thumbs) stay on disk under `SAAS_DATA_DIR` unless `S3_BUCKET` is configured.

### Quick local SaaS stack

```bash
docker compose -f docker-compose.saas.yml up --build
```

Includes Postgres 16, MinIO (S3-compatible), and the app with `SAAS_ALLOW_ANONYMOUS=1` for easy dev.

### SaaS environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `DEPLOY_MODE` | Yes | Set to `saas` |
| `SAAS_DATA_DIR` | Recommended | Repos, exports, thumbs scratch dir (default `./data`) |
| `DATABASE_URL` | **Yes (prod)** | Postgres connection string — migrations on startup; app data in Postgres |
| `S3_BUCKET` | Optional | Tenant-prefixed S3 blobs |
| `S3_REGION` / `AWS_REGION` | With S3 | AWS region |
| `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` | With S3 | Credentials (MinIO: root user/pass) |
| `S3_ENDPOINT` | MinIO/dev | Custom S3 endpoint URL |
| `S3_FORCE_PATH_STYLE` | MinIO | Set `1` for path-style MinIO URLs |
| `SESSION_SECRET` | OAuth / prod | Required in production when auth enabled |
| `ALLOWED_ORIGINS` | Prod | Comma-separated CORS origins (alias: `CORS_ORIGIN`) |
| `SAAS_BASIC_AUTH` | Optional | `user:password` for HTTP Basic dev auth |
| `GITHUB_CLIENT_ID` / `SECRET` / `GITHUB_CALLBACK_URL` | OAuth | GitHub OAuth app |
| `SAAS_ALLOW_ANONYMOUS` | Optional | `1` to allow unauthenticated API (dev only) |
| `REDIS_URL` | Optional | BullMQ-backed job queue for horizontal scaling |
| `UPLOAD_MAX_BYTES` | Optional | Request body / upload size limit |

### Auth routes

| Route | Description |
|-------|-------------|
| `GET /auth/github` | Start GitHub OAuth |
| `GET /auth/callback` | OAuth callback |
| `POST /auth/logout` | Clear session |
| `GET /auth/me` | Current user + tenant |
| `POST /auth/dev-login` | SaaS dev session |

### Data migration from desktop

```bash
cd web
npx tsx scripts/import-sqlite.ts \
  --source-db ~/.print-partner/print-partner.db \
  --source-repos ~/.print-partner/repos \
  --dest ./data
```

### Exports and imports (web / Docker)

- **Exports:** job endpoints write files under `exports/` in the data dir and return `download_url` (e.g. `/exports/Plan/checklist.html`). The UI triggers a browser download via `GET /exports/*` with `Content-Disposition: attachment`.
- **Kit bundle import (browser):** upload `.print-partner-kit.zip` with `POST /imports/kit-bundle` (multipart field `file`). Command palette **Import shared build…** uses this path.
- **Kit bundle import (server path):** `POST /jobs/import-kit-bundle` or `POST /admin/import-kit-bundle` with `{ "path": "…" }` only works when the file already exists on the engine host (Tauri desktop or admin scripts) — not for remote web users.
- **Source ZIP import (browser):** `POST /sources/:id/upload-zip` (multipart). Tauri desktop may use `POST /sources/:id/import-archive` with a local filesystem path instead.

### Smoke test

See [scripts/SMOKE_CHECKLIST.md](./scripts/SMOKE_CHECKLIST.md).

## Known intentional gaps vs desktop

- No PyVista/VTK mesh preview server-side (client thumbnails only)
- Printables/MakerWorld source create returns `501`
- Community manifest “report issue” uses export-draft stub body
- Bambu metadata in 3MF is minimal (plate JSON + slice_info stub; desktop also lacks full slicer state)
