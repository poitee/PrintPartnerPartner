# Sentry (release + source maps)

Print Partner publishes a Sentry release and uploads SPA source maps during the **Release** workflow (`v*` tags → GHCR image). Ordinary PR/`web-ci` runs never call Sentry, so missing secrets cannot fail validation.

## What Chad must configure

### 1. Sentry project

1. Create (or reuse) a **browser/JavaScript** project in Sentry.
2. Note the organization slug and project slug.
3. Create an **Organization Auth Token** (Settings → Auth Tokens / Organization Tokens) with at least:
   - `project:releases`
   - `org:read`
4. Copy the project’s **DSN** (Client Keys) if you want runtime error capture in official release images.

### 2. GitHub Actions secrets / variables

Repository → **Settings → Secrets and variables → Actions**.

| Name | Type | Required for upload? | Purpose |
|------|------|----------------------|---------|
| `SENTRY_AUTH_TOKEN` | **Secret** | Yes | Organization auth token (never commit). |
| `SENTRY_ORG` | **Variable** (preferred) or secret | Yes | Sentry organization slug. |
| `SENTRY_PROJECT` | **Variable** (preferred) or secret | Yes | Sentry project slug. |
| `VITE_SENTRY_DSN` | **Secret** (optional) | No | Browser DSN baked into official tagged images only. Omit to ship releases with maps uploaded but no runtime SDK reporting. |

Do not put auth tokens, org IDs, project IDs, or DSNs in source. The workflow reads them only from GitHub Actions configuration.

### 3. When uploads run

| Event | Sentry release / source maps |
|-------|------------------------------|
| Pull requests / fork PRs | **Never** |
| `web-ci.yml` (lint/typecheck/test) | **Never** |
| Push tag `v*` → `release.yml` | **Yes**, only if `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, and `SENTRY_PROJECT` are all set; otherwise the release still builds and publishes GHCR and skips Sentry with a log line |

Release name matches `PP_VERSION`: for tag `v3.1.0` the Sentry release is `3.1.0-web`. Commits are associated via `getsentry/action-release` (`set_commits: auto`, full git history checkout).

## Build / artifact flow

1. Release CI builds the web monorepo with Vite `build.sourcemap: "hidden"` and `VITE_SENTRY_RELEASE` (and optional `VITE_SENTRY_DSN`).
2. If Sentry is configured, `getsentry/action-release@v3` injects Debug IDs, uploads maps from `web/apps/web/dist`, creates/finalizes the release, and links commits.
3. `*.map` files are deleted before the Docker image is built.
4. The image build sets `USE_PREBUILT_WEB=1` so the GHCR image ships the **same** JS that received Debug IDs (maps still absent).

Local `docker compose build` / Dockerfile builds without prebuilt dist still generate hidden maps during `npm run build`, then delete them before the runtime stage — maps are not publicly shipped.

## Runtime behavior

`@sentry/react` initializes only when `VITE_SENTRY_DSN` was present at SPA build time. Self-host builds without that secret remain unchanged (no Sentry network calls). `sendDefaultPii` stays off; Session Replay is not enabled.
