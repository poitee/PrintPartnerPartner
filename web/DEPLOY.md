# Deploying Print Partner Web

**First time with Docker?** See the beginner install guide: [docs/INSTALL.md](../docs/INSTALL.md).

## Self-host (default)

### Docker Compose

From the repository root:

```bash
docker compose pull && docker compose up -d
```

Open [http://localhost:8080](http://localhost:8080). Data persists in the `print-partner-data` volume (`/data` in the container). To build from source instead of pulling, use `docker compose up --build`.

### Published images

Release images are published to GitHub Container Registry:

| Image | Tags | Platforms |
|-------|------|-----------|
| `ghcr.io/poitee/print-partner` | `latest`, `X.Y.Z` (one per release, e.g. `3.0.0`) | `linux/amd64`, `linux/arm64` |

Each image bakes the release version into `PP_VERSION` (e.g. `3.0.0-web`), which `GET /health` reports and the in-app update checker compares against GitHub releases. The compose files keep a `build:` section as a fallback, so `docker compose up --build` always works without the registry.

**Pull failures:** GHCR packages are private by default until visibility is set. The release workflow sets `ghcr.io/poitee/print-partner` to **public** after each tagged push. If `docker compose pull` returns `denied` or `unauthorized`, use `docker compose up --build` instead, or `docker login ghcr.io` with a token that has `read:packages`. See [docs/INSTALL.md](../docs/INSTALL.md#denied-or-unauthorized-when-pulling-the-image).

The app service has a healthcheck that polls `GET /health` every 30s using Node's built-in `fetch` (the `node:22-bookworm-slim` runtime image ships no curl/wget). `docker ps` shows the container as `healthy` once the server responds.

### Environment variables (self-host)

| Variable | Default | Description |
|----------|---------|-------------|
| `PRINT_PARTNER_DATA_DIR` | `./data` | SQLite DB, repos, exports, thumbs |
| `HOST` | `127.0.0.1` | Bind address |
| `PORT` | `18765` (dev) / `8080` (Docker) | HTTP port |
| `STATIC_DIR` | unset | When set, serve built SPA from this directory |
| `DEPLOY_MODE` | `self-host` | `self-host` or `saas` |
| `CORS_ORIGIN` / `ALLOWED_ORIGINS` | `true` | CORS allowed origin(s); comma-separated list for multiple |
| `PP_VERSION` | `3.0.0-web` (baked into release images) | Health payload version |
| `BASIC_AUTH_USER` / `BASIC_AUTH_PASS` | unset | Optional HTTP Basic protection |
| `UPLOAD_MAX_BYTES` | `536870912` | Multipart upload limit (512 MiB) |
| `SOURCE_DOCS_MAX_BYTES` | `1073741824` | Per-source budget for synced markdown/PDF docs (~1 GiB). Operator escape hatch only. |
| `PRINT_PARTNER_API_KEY` | unset | When set (self-host), requires Bearer or `X-Print-Partner-Api-Key` on `/api/v1/*` |
| `OPENAPI_UI` | unset | Set to `1` to expose `/api/v1/docs` in production |
| `REDIS_URL` | unset | Optional; when set in SaaS, enables BullMQ job queue (see SaaS) |
| `PRINT_PARTNER_UPDATE_CHECK` | enabled | Set to `0` to disable in-app update checks |
| `GITHUB_REPO` | `poitee/PrintPartnerPartner` | GitHub repo for release lookup |
| `PRINT_PARTNER_LATEST_VERSION` | unset | Air-gapped override — skip GitHub and compare against this version |
| `PRINT_PARTNER_UPDATE_CHECK_CACHE_HOURS` | `12` | How long to cache the latest release lookup |
| `AI_ENABLED` | unset | Operator fallback: set to `1` to enable the kit advisor via env when no Settings integration is configured |
| `AI_PROVIDER` | `none` | `anthropic`, `openai`, `ollama`, or `none` (env fallback) |
| `ANTHROPIC_API_KEY` | unset | Required when `AI_PROVIDER=anthropic` (env fallback) |
| `OPENAI_API_KEY` | unset | Required when `AI_PROVIDER=openai` (env fallback) |
| `OPENAI_BASE_URL` | `https://api.openai.com` | Optional OpenAI-compatible base URL (env fallback) |
| `OLLAMA_URL` | `http://127.0.0.1:11434` | Default Ollama host for env fallback / Settings defaults |
| `AI_MODEL` | provider default | Model id (env fallback) |
| `AI_MAX_TOKENS` | `2048` | Max completion tokens per chat turn (also used when Settings omits `max_tokens`) |
| `AI_DAILY_REQUEST_BUDGET` | `0` (unlimited) | Soft per-tenant daily chat request cap; `0` disables. Overridable via Settings `daily_request_budget`. Exceeded → `429` on `/assistant/chat` |
| `AI_DAILY_TOKEN_BUDGET` | `0` (unlimited) | Soft per-tenant daily estimated-token cap (chars÷4 + reply); `0` disables. Overridable via Settings `daily_token_budget`. Exceeded → `429` |
| `ASSISTANT_ALLOW_URL_INGEST` | enabled | Set to `0` to disable `ingest_guide_url` / `fetch_web_page` (SSRF-safe outbound fetch of user-supplied URLs) |
| `ASSISTANT_GUIDE_INGEST_MAX_BYTES` | `524288` (512 KiB) | Max response body size for a single guide / page URL fetch |
| `SEARCH_PROVIDER` | unset | Prefer `brave`, `exa`, `duckduckgo`, `anthropic-native`, `openai-native`, or `none`. When unset, resolution picks provider-native then DuckDuckGo |
| `SEARCH_API_KEY` | unset | Shared key for Brave or Exa when that provider is selected |
| `BRAVE_API_KEY` | unset | Alias for Brave Search (`SEARCH_PROVIDER=brave`) |
| `EXA_API_KEY` | unset | Alias for Exa Search (`SEARCH_PROVIDER=exa`) |

**URL ingest safety:** `ingest_guide_url`, `fetch_web_page`, and `web_search` use the same SSRF guard as cover/image fetches (`safeOutboundFetch`): HTTP(S) only, DNS-resolved, private/loopback/metadata blocked. Guide and search text is treated as untrusted evidence; mutations require Apply cards (`propose_add_source`, etc.). There is no autonomous crawler.

### Search backends

The kit advisor `web_search` tool can use several HTTP / provider backends (`web/apps/server/src/services/search/`):

| Backend | When | Notes |
|---------|------|--------|
| **anthropic-native** / **openai-native** | Active AI provider is Anthropic or OpenAI | Status reports native search availability; structured HTTP tool hits still come from an HTTP backend (Brave/Exa/DuckDuckGo) |
| **brave** | `SEARCH_PROVIDER=brave` | Requires `SEARCH_API_KEY` or `BRAVE_API_KEY` |
| **exa** | `SEARCH_PROVIDER=exa` | Requires `SEARCH_API_KEY` or `EXA_API_KEY` |
| **duckduckgo** | Default free fallback | HTML scrape — brittle; prefer Brave/Exa for reliability |

**Resolution order:** Settings `search_provider` (when set) → env `SEARCH_PROVIDER` → provider-native (when the active AI provider supports it) → `duckduckgo`. Settings `search_api_key` overrides env search keys when present.

### Link → build pipeline

When a user pastes a guide or product URL into the kit advisor:

1. `fetch_web_page` / `ingest_guide_url` (or pasted text via `ingest_guide_text`) gather untrusted page evidence.
2. After a relevant source is on the plan and synced, `detect_build_decisions` proposes variant / optional-mod / config candidates.
3. The advisor walks decisions one at a time; confirming choices emits `update_kit_selections` **Apply** cards (readable key → value selections in the SPA).

Mutations never auto-apply — the user must click Apply.

### Kit advisor MCP (stdio)

A thin **stdio MCP server** exposes the same assistant product verbs (`get_kit_catalog`, `ingest_guide_url`, `add_addon`, …) for hosts like Cursor / Claude Desktop. It opens the self-host SQLite data dir and reuses `invokeAssistantTool` / `applyAssistantAction`. Mutating tools only **propose**; call `confirm_apply` (optional `suggested_excludes` override) or `dismiss_proposed_action` — same confirm-to-apply rule as the SPA.

```bash
cd web
# Optional: point at the same data volume the app uses
export PRINT_PARTNER_DATA_DIR=./data
# Optional: default plan_id when tools omit it
export PRINT_PARTNER_MCP_PLAN_ID=1
npm run mcp -w @print-partner/server
```

Cursor / Claude Desktop example (`mcp.json` / Claude config):

```json
{
  "mcpServers": {
    "print-partner": {
      "command": "npm",
      "args": ["run", "mcp", "-w", "@print-partner/server"],
      "cwd": "/absolute/path/to/PrintPartnerPartner/web",
      "env": {
        "PRINT_PARTNER_DATA_DIR": "/absolute/path/to/data",
        "DEPLOY_MODE": "self-host"
      }
    }
  }
}
```

Requires `DEPLOY_MODE=self-host` (default). Do not point two writers at the same SQLite file concurrently with the running Docker/API process unless you accept SQLite locking risk — prefer stopping the app or using a copy of `PRINT_PARTNER_DATA_DIR` for MCP experiments.

**Recommended (self-host):** configure the kit advisor in the UI under **Settings → AI assistant** (provider, model, budgets, web search, URL research, Ollama context). An enabled `ai_assistant` integration takes precedence over env for every field it sets. Env vars remain the SaaS/operator default path when no Settings integration exists (or when a field is left unset / Auto). Keys stay server-side and are redacted in integration list responses / never returned by `/assistant/status`.

**Settings vs env (hosted-ready):** user-facing knobs live on the per-tenant `ai_assistant` integration JSON:

| Settings field | Env fallback |
|----------------|--------------|
| `provider`, `model`, `api_key`, `base_url` / `ollama_url` | `AI_PROVIDER`, `AI_MODEL`, `ANTHROPIC_API_KEY` / `OPENAI_API_KEY`, `OLLAMA_URL` / `OPENAI_BASE_URL` |
| `max_tokens` | `AI_MAX_TOKENS` |
| `daily_request_budget` / `daily_token_budget` | `AI_DAILY_*` |
| `search_provider` (`null` / Auto = no override) | `SEARCH_PROVIDER` |
| `search_api_key` | `SEARCH_API_KEY` / `BRAVE_API_KEY` / `EXA_API_KEY` |
| `allow_url_ingest` | `ASSISTANT_ALLOW_URL_INGEST` |
| `guide_ingest_max_bytes` | `ASSISTANT_GUIDE_INGEST_MAX_BYTES` |
| `ollama_num_ctx` | `OLLAMA_NUM_CTX` (default 16384) |

`SOURCE_DOCS_MAX_BYTES` and MCP `PRINT_PARTNER_MCP_PLAN_ID` remain operator-only (not in Settings). `GET /assistant/status` reports `source` (`settings` \| `env` \| `none`) and search `configured` without secrets.

**Learning from your other builds (examples, not training):** when **Use my other builds as examples** is on (default), the advisor receives compact summaries of other plans this user/tenant can access (layers, kit selections, inferred stack preset). That is few-shot *context* for the current chat only — it does **not** fine-tune or train the model. Toggle it in Settings or per-chat in the kit advisor sheet. Mutating suggestions appear as **Apply / Dismiss** action cards; nothing writes until `POST /assistant/actions/apply`.

**Decision memory (Apply / Dismiss / thumbs — not training):** confirmed Apply cards and Dismissals are stored as `plan_decisions` and summarized into every chat system prompt (`## User preferences` + cross-plan memory). High-frequency Sync / Update workflow applies (`start_sync`, `start_recompute`, Sync→Update recipes) are filtered out of Prefer/Avoid digests unless they are the only signal. Dismissed fingerprints are hard-blocked from tool proposes and soft suggestions until the user asks again. Thumbs up/down (optional one-line reason) update ranking scores only — raw comments never enter the prompt; high-confidence stack tokens may appear as `Preferred stacks (thumbs): …`. Clear chat history does **not** erase decisions or feedback. To reset memory: kit advisor sheet **Clear decisions** (current plan) / **Clear thumbs**, or API `DELETE /assistant/decisions?plan_id=<id>` (one plan), `DELETE /assistant/decisions?all=true` (tenant), `DELETE /assistant/feedback` (thumbs). Self-host debug: `GET /assistant/preferences?plan_id=` returns the digest string used in the prompt.

**Chat history:** successful turns are stored per tenant (`GET/DELETE /assistant/history`). The kit advisor sheet reloads prior turns when opened and can **Clear** history. Continuing a conversation sends the loaded turns plus the new message to `/assistant/chat`.

**Domain research packs (not fine-tuning):** curated YAML/MD under `assistant-domain/` is summarized into every chat system prompt (capped). Ship defaults live in the server package; you can import research output via `POST /assistant/domain/import` (writes under `PRINT_PARTNER_DATA_DIR/assistant-domain/`). On startup the server upserts **Advisor notes** (Workflow / Pitfalls / Quotes) onto matching live sources when the pack files change. Research brief + schemas: [`docs/assistant-research-brief.md`](../docs/assistant-research-brief.md), [`docs/assistant-domain-ingest-schema.md`](../docs/assistant-domain-ingest-schema.md). Check loaded pack with `GET /assistant/domain`. Re-backfill notes: `POST /assistant/domain/import` with `{"backfill_notes":true,"write_files":false}`.

**Daily usage caps:** optional soft budgets (`AI_DAILY_REQUEST_BUDGET` / `AI_DAILY_TOKEN_BUDGET`, or Settings fields `daily_request_budget` / `daily_token_budget`) count per tenant per UTC day. When exceeded, `POST /assistant/chat` returns **429** with a clear problem detail. `/assistant/status` reports used vs budget when caps are set. Rate limits (requests/minute) still apply separately.

**Docker Compose + Ollama on the host:** the app container cannot reach Ollama at `http://127.0.0.1:11434` (that is the container’s own loopback, not the Mac/Linux host). Do all of the following:

1. **Settings URL** (or `OLLAMA_URL`): use `http://host.docker.internal:11434` — not `127.0.0.1` / `localhost`. Compose defines `extra_hosts: host.docker.internal:host-gateway` so this works on Linux as well as Docker Desktop (Mac/Windows).
2. **Host Ollama must accept non-localhost clients.** Ollama often binds `127.0.0.1` only, which rejects Docker bridge traffic. On the **host** (not in Compose), start Ollama with:
   ```bash
   # macOS (launchd) — then restart Ollama
   launchctl setenv OLLAMA_HOST 0.0.0.0
   # or for a one-off shell session:
   OLLAMA_HOST=0.0.0.0 ollama serve
   ```
   Confirm with `lsof -nP -iTCP:11434 -sTCP:LISTEN` — you want `*:11434` or `0.0.0.0:11434`, not `127.0.0.1:11434`.
3. **Recreate the app container** after pulling compose changes: `docker compose up -d --force-recreate`.
4. In **Settings → AI assistant**, set the URL above, set **Model** to an exact name from `ollama list` on the host (e.g. `llama3.1:latest` — not a placeholder like `llama3.2` unless that model is installed), save, and click **Test connection**. Test verifies both reachability and that the model exists. A failure usually means wrong URL (`127.0.0.1` inside the container), Ollama still bound to localhost only, or a model name that is not installed.

Env fallback example:

```yaml
environment:
  AI_ENABLED: "1"
  AI_PROVIDER: ollama
  OLLAMA_URL: http://host.docker.internal:11434
  AI_MODEL: llama3.1:latest
```

From inside the running container you can smoke-test: `node -e "fetch('http://host.docker.internal:11434/api/tags').then(r=>console.log(r.status)).catch(e=>console.error(e))"`. Chat uses Ollama’s **native `POST /api/chat`** (not the OpenAI-compatible endpoint) so the server can set `num_ctx` — Ollama’s OpenAI endpoint ignores context-size options and silently truncates long prompts, which cuts off the system prompt. Default context is 16384 tokens; override with Settings `ollama_num_ctx` or env `OLLAMA_NUM_CTX`. The model name must exist on the host.

### Checking for app updates

When update checks are enabled (default), the server compares `PP_VERSION` to the latest [GitHub release](https://github.com/poitee/PrintPartnerPartner/releases) (cached ~12 hours). The web UI shows a dismissible banner when a newer version exists, and **Settings → About & updates** lists your version with a manual refresh.

Self-host Docker upgrade:

```bash
docker compose pull && docker compose up -d
```

Disable checks entirely with `PRINT_PARTNER_UPDATE_CHECK=0`. Offline or failed lookups never show an error banner.

### Releasing (maintainers)

Tag a release and push it; CI does the rest:

```bash
git tag v3.1.0
git push origin v3.1.0
```

The `release.yml` workflow builds the multi-arch image (`linux/amd64` + `linux/arm64`), pushes `ghcr.io/poitee/print-partner:latest` and `:3.1.0` with `PP_VERSION=3.1.0-web` baked in, sets the GHCR package visibility to **public**, and creates a GitHub Release with auto-generated notes. Before tagging, move the `[Unreleased]` CHANGELOG entries under the new version and bump `web/package.json` plus the `PP_VERSION` defaults in `web/apps/server/src/config.ts` and the `Dockerfile`.

### Local development

```bash
cd web
npm ci
npm run dev   # predev builds @print-partner/contracts and @print-partner/domain first
```

API: `http://127.0.0.1:18765` · Vite UI: `http://127.0.0.1:5173`

Versioned API for integrations: `http://127.0.0.1:18765/api/v1` — see [`../docs/API.md`](../docs/API.md). Optional [Spoolman](../docs/integrations/SPOOLMAN.md) filament inventory connects in **Settings → Integrations**.

## SaaS mode (`DEPLOY_MODE=saas`)

SaaS mode uses **Postgres for app data** when `DATABASE_URL` is set (tenant-scoped rows). File blobs (repos, exports, thumbs) stay on disk under `SAAS_DATA_DIR` unless `S3_BUCKET` is configured.

### Quick local SaaS stack

```bash
docker compose -f docker-compose.saas.yml up --build
```

Includes Postgres 16, [RustFS](https://rustfs.com) (S3-compatible), and the app with `SAAS_ALLOW_ANONYMOUS=1` for easy dev. The compose file creates the `print-partner` bucket on first start.

**Migrating from MinIO:** remove the old `pp-minio` volume (`docker volume rm <project>_pp-minio`) — RustFS uses a different on-disk format. Blob data in the old volume is not portable; re-upload or re-sync sources after switching.

### SaaS environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `DEPLOY_MODE` | Yes | Set to `saas` |
| `SAAS_DATA_DIR` | Recommended | Repos, exports, thumbs scratch dir (default `./data`) |
| `DATABASE_URL` | **Yes (prod)** | Postgres connection string — migrations on startup; app data in Postgres |
| `S3_BUCKET` | Optional | Tenant-prefixed S3 blobs |
| `S3_REGION` / `AWS_REGION` | With S3 | AWS region |
| `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` | With S3 | S3 credentials (RustFS dev stack: `rustfsadmin` / `rustfsadmin`) |
| `S3_ENDPOINT` | S3-compatible dev | Custom S3 endpoint URL (e.g. `http://rustfs:9000`) |
| `S3_FORCE_PATH_STYLE` | S3-compatible dev | Set `1` for path-style URLs (RustFS, MinIO, Garage, etc.) |
| `MULTI_USER` | Optional | `1` enables login (self-host or saas); first registered user claims existing data |
| `SESSION_SECRET` | Multi-user / OAuth / prod | Required when `MULTI_USER=1` or OAuth in production |
| `ALLOWED_ORIGINS` | Prod | Comma-separated CORS origins (alias: `CORS_ORIGIN`) |
| `SAAS_BASIC_AUTH` | Optional | `user:password` for HTTP Basic dev auth |
| `GITHUB_CLIENT_ID` / `SECRET` / `GITHUB_CALLBACK_URL` | OAuth | GitHub OAuth app |
| `DISCORD_CLIENT_ID` / `SECRET` / `DISCORD_CALLBACK_URL` | OAuth | Discord OAuth app (`/auth/discord/callback`) |
| `SAAS_ALLOW_ANONYMOUS` | Optional | `1` to allow unauthenticated API (dev only) |
| `REDIS_URL` | Optional | BullMQ-backed job queue for horizontal scaling |
| `UPLOAD_MAX_BYTES` | Optional | Request body / upload size limit |

### Auth routes

| Route | Description |
|-------|-------------|
| `GET /auth/github` | Start GitHub OAuth |
| `GET /auth/callback` | GitHub OAuth callback |
| `GET /auth/discord` | Start Discord OAuth |
| `GET /auth/discord/callback` | Discord OAuth callback |
| `POST /auth/register` | Email + password registration (`MULTI_USER=1`) |
| `POST /auth/login` | Email + password login |
| `POST /auth/forgot-password` | Request a password reset email |
| `POST /auth/reset-password` | Set a new password using a reset token |
| `POST /auth/change-password` | Change password while signed in |
| `POST /auth/logout` | Clear session |
| `GET /auth/me` | Current user + tenant |
| `POST /auth/dev-login` | Dev session helper |
| `POST /plans/:id/shares` | Send build copy to another user |
| `GET /shares/incoming` | List pending shares for current user |
| `POST /shares/:token/accept` | Import shared build as new plan |
| `DELETE /shares/:id` | Revoke a pending share |

### Password reset email (multi-user)

When `MULTI_USER=1`, users can reset forgotten passwords from **Sign in → Forgot password?** or `POST /auth/forgot-password`.

| Variable | Required | Description |
|----------|----------|-------------|
| `SMTP_HOST` | For email delivery | SMTP server hostname |
| `SMTP_PORT` | Optional | Default `587` (`465` implies TLS) |
| `SMTP_USER` / `SMTP_PASS` | Optional | SMTP credentials when required by your provider |
| `SMTP_FROM` | With `SMTP_HOST` | From address (e.g. `Print Partner <noreply@example.com>`) |
| `SMTP_SECURE` | Optional | Set `1` for implicit TLS (typical on port 465) |
| `APP_PUBLIC_URL` | Recommended | Public app URL for reset links (e.g. `https://print.example.com`). Without this, the link uses the incoming request `Host` header. |
| `PASSWORD_RESET_DEV_EXPOSE` | Dev only | When SMTP is not configured, non-production mode returns `dev_reset_url` in the API response and logs the link. Set `0` to disable. |

Without SMTP configured in production, reset requests are accepted but no email is sent — configure SMTP for production deployments.

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
- **Kit bundle import (server host):** `POST /admin/import-kit-bundle` with `{ "path": "…" }` when the `.print-partner-kit` file already exists under the data directory (admin scripts on the same machine as the engine).
- **Source ZIP import:** `POST /sources/:id/upload-zip` (multipart upload only).

### Smoke test

See [scripts/SMOKE_CHECKLIST.md](./scripts/SMOKE_CHECKLIST.md).

## Known gaps

- No PyVista/VTK mesh preview server-side (client thumbnails only)
- Printables/MakerWorld source create returns `501`
- Community manifest “report issue” uses export-draft stub body
- Bambu metadata in 3MF is minimal (plate JSON + slice_info stub)
