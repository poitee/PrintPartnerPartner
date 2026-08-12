<p align="center">
  <img src="docs/logo.png" alt="Print Partner logo" width="128" />
</p>

<h1 align="center">Print Partner</h1>

<p align="center">
  <strong>Self-hostable web workflow for layered STL kits</strong><br>
  Base repo plus add-ons, accent parts, quantities in filenames, and a pile of folders to keep straight.
</p>

<p align="center">
  <a href="https://github.com/sponsors/poitee"><img src="https://img.shields.io/badge/GitHub_Sponsors-Sponsor-ea4aaa?style=for-the-badge&logo=github-sponsors&logoColor=white" alt="Sponsor on GitHub Sponsors"></a>
</p>

<p align="center">
  <a href="https://poitee.github.io/PrintPartnerPartner/">Project site</a>
  ·
  <a href="#quick-start--docker-self-host">Quick start</a>
  ·
  <a href="#ai-kit-advisor-optional">AI kit advisor</a>
  ·
  <a href="#screenshots">Screenshots</a>
  ·
  <a href="docs/ARCHITECTURE.md">Architecture</a>
  ·
  <a href="LICENSE-SUMMARY.md">License</a>
</p>

<p align="center">
  <code>Library</code> → <code>Plan</code> → <code>Parts</code> → <code>Progress</code>
</p>

<p align="center">
  <sub>
    Plan management — header <strong>Create build</strong>, <strong>Manage builds</strong> on Plan, or the sidebar <strong>Builds</strong> page.
    Print checkoff lives on <strong>Progress</strong> (legacy <code>/checkoff</code> redirects there).
  </sub>
</p>

<p align="center">
  <sub>
    Ships as a single Docker container — <strong>Fastify</strong> API + <strong>React</strong> SPA on one port.
    Warm UI with <strong>light</strong>, <strong>dark</strong>, or <strong>system</strong> theme. Data stays in a volume you control.
    Optional <strong>kit advisor</strong> (bring your own Anthropic / OpenAI key, or run <strong>Ollama</strong> fully local).
    Multi-tenant <strong>SaaS</strong> mode (Postgres + S3 + OAuth) is available for hosted deployments.
  </sub>
</p>

---

## What it does

| Step | What you are doing |
|------|--------------------|
| **Library** | Add GitHub repos, local folders, or zips; assign categories; search STLs across every synced repo; see **update available** badges; sync and set import rules. |
| **Plan** | **Manage builds** (create/switch plans), attach base/add-on sources, pick STL files, set **role filament colors** (previews update live), **Update build** when stale, kit/manifest options, inline repo **Docs**, export STLs or share a plan bundle. |
| **Parts** | Confirm validation by role and filament, browse included parts with 3D previews, edit quantities, **Export STLs** / **3MF**, and **Export missing STLs**. |
| **Progress** | Track **print checkoff** (per-unit progress, filters, printable checklist). |

**Managing builds** (not a pipeline step): use the header **Create build** button and plan picker, the collapsible **Manage builds** panel on Plan, or the **Builds** page in the sidebar to create, rename, duplicate, and delete plans. The active plan is shared across Plan, Parts, and Progress.

**Kit advisor (optional AI):** research kits and mods with web search, paste a product/guide URL, walk decisions with you, and propose changes as **Apply** cards — nothing mutates until you confirm. Configure under **Settings → AI assistant**. Full guide: [`docs/KIT_ADVISOR.md`](docs/KIT_ADVISOR.md).

**Tips:** **⌘K / Ctrl+K** opens the command palette (sync, recompute, exports, navigation). Collapse the left sidebar to an icon rail; the first-run **Progress** widget hides after you complete Library → Plan → Parts → Progress once. Open **Help** in the sidebar for the full workflow guide.

Optional **[Spoolman](docs/integrations/SPOOLMAN.md)** integration: connect a Spoolman instance in Settings to pick filaments from your inventory on Plan and see read-only spool remaining weights in Parts.

---

## AI kit advisor (optional)

The app works fully **without** AI. When you want help researching kits, comparing mods, or walking a build, turn on the **kit advisor**.

Configure it in the UI: **Settings → AI assistant**. Env vars are only an operator fallback when no Settings integration is saved (see [`web/DEPLOY.md`](web/DEPLOY.md)).

### Bring your own AI account

| Provider | What you need |
|----------|----------------|
| **Anthropic** | An Anthropic API key + model (default Claude Sonnet). |
| **OpenAI** | An OpenAI API key + model (default `gpt-4o-mini`), or any **OpenAI-compatible** base URL. |

Paste the key in Settings (write-only; never shown again). Keys stay on your server / tenant — not in the browser after save.

### Run fully local with Ollama

Use **[Ollama](https://ollama.com/)** on the same machine (or LAN) for a free, offline-capable advisor:

1. Install Ollama and pull a model (`ollama pull llama3.1`).
2. In **Settings → AI assistant**, set provider **Ollama**, URL (e.g. `http://127.0.0.1:11434` for local Node, or `http://host.docker.internal:11434` when Print Partner runs in Docker), and the exact model name from `ollama list`.
3. Click **Test connection**, then open **Advisor** in the header.

Docker + host Ollama needs Ollama listening beyond loopback (`OLLAMA_HOST=0.0.0.0`) — details in [`docs/KIT_ADVISOR.md`](docs/KIT_ADVISOR.md) and [`web/DEPLOY.md`](web/DEPLOY.md).

### Optional web search & URL research

- **Search:** Auto / DuckDuckGo (free) / Brave / Exa (API key) / Disabled — all in Settings.
- **URL research:** paste a guide or product page; the advisor fetches text (SSRF-guarded) and proposes Apply cards — never silent writes.
- Soft **daily request/token budgets** are optional.

More: [`docs/KIT_ADVISOR.md`](docs/KIT_ADVISOR.md) · operator env table in [`web/DEPLOY.md`](web/DEPLOY.md).

---

## Screenshots

Screenshots switch with your GitHub **light / dark** theme (or see both on the [project site](https://poitee.github.io/PrintPartnerPartner/)).

### Library

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/screenshots/dark/sources.png">
  <source media="(prefers-color-scheme: light)" srcset="docs/screenshots/light/sources.png">
  <img src="docs/screenshots/light/sources.png" alt="Library — source library with categories, sync status, update badges, and global STL search.">
</picture>

Source library: categories, sync status, **update available** badges, global STL search, per-source import rules.

### Builds

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/screenshots/dark/builds.png">
  <source media="(prefers-color-scheme: light)" srcset="docs/screenshots/light/builds.png">
  <img src="docs/screenshots/light/builds.png" alt="Builds — plan manager with active-build dropdown, create, rename, duplicate, and delete.">
</picture>

Sidebar **Builds** page plus the same controls in **Manage builds** on Plan and the header plan picker.

### Plan

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/screenshots/dark/build.png">
  <source media="(prefers-color-scheme: light)" srcset="docs/screenshots/light/build.png">
  <img src="docs/screenshots/light/build.png" alt="Plan — Manage builds, role filament colors, STL pickers with live preview, and Update build.">
</picture>

**Manage builds**, role colors, attach sources, pick STLs (live 3D preview), **Update build** when stale, kit options, **Docs**, export and share.

### Parts

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/screenshots/dark/review.png">
  <source media="(prefers-color-scheme: light)" srcset="docs/screenshots/light/review.png">
  <img src="docs/screenshots/light/review.png" alt="Parts — validation, parts with 3D previews, quantity edits, and exports.">
</picture>

Validation by role and filament, parts list with **3D previews**, quantity edits, and STL/3MF export.

### Progress

Print checkoff — per-unit progress, filters, and printable checklist. Capture with `docs/scripts/capture-screenshots.mjs` (writes `progress.png`); re-run if the PNG is not yet in `docs/screenshots/{light,dark}/`.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/screenshots/dark/progress.png">
  <source media="(prefers-color-scheme: light)" srcset="docs/screenshots/light/progress.png">
  <img src="docs/screenshots/light/progress.png" alt="Progress — print checkoff with per-unit progress and filters.">
</picture>

### AI assistant (Settings)

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/screenshots/dark/settings-ai.png">
  <source media="(prefers-color-scheme: light)" srcset="docs/screenshots/light/settings-ai.png">
  <img src="docs/screenshots/light/settings-ai.png" alt="Settings — AI assistant card with provider, model, search, and budgets.">
</picture>

**Settings → AI assistant** — Anthropic, OpenAI, or Ollama; web search; URL research; budgets.

### Kit advisor

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/screenshots/dark/advisor.png">
  <source media="(prefers-color-scheme: light)" srcset="docs/screenshots/light/advisor.png">
  <img src="docs/screenshots/light/advisor.png" alt="Kit advisor sheet open beside the build workflow.">
</picture>

Header **Advisor** opens the kit advisor sheet — chat, research tools, and Apply / Dismiss cards.

---

## Quick start — Docker self-host

**Requirements:** Docker with Compose v2.

From the repository root, pull the pre-built image from GitHub Container Registry and start it:

```bash
docker compose pull && docker compose up -d
```

Open [http://localhost:8080](http://localhost:8080). Data persists in the `print-partner-data` volume, mounted at `/data` inside the container (SQLite database, synced repos, exports, and thumbnails).

Images are published to **`ghcr.io/poitee/print-partner`** (`latest` plus a tag per release, e.g. `3.0.0`). To build from source instead:

```bash
docker compose up --build
```

**New to Docker?** See the step-by-step guide in [`docs/INSTALL.md`](docs/INSTALL.md). Quick checklist:

1. Install [Docker Desktop](https://docs.docker.com/get-docker/) (or Docker Engine + Compose on Linux) and verify `docker compose version`.
2. Clone this repo and `cd` into it.
3. Run `docker compose pull && docker compose up -d` (or `docker compose up --build` to build from source).
4. Open [http://localhost:8080](http://localhost:8080).
5. Add a **Source** on the Sources page, then create a build with **Create build** in the header or **Manage builds** on Build (or open **Builds** in the sidebar).
6. Optional: open **Settings → AI assistant** to connect Anthropic, OpenAI, or local Ollama — see [`docs/KIT_ADVISOR.md`](docs/KIT_ADVISOR.md).

### Environment variables (self-host)

Defaults match `web/apps/server/src/config.ts`; the Docker image overrides `HOST`, `PORT`, `PRINT_PARTNER_DATA_DIR`, and `STATIC_DIR` (see `Dockerfile`).

| Variable | Default | Description |
|----------|---------|-------------|
| `PRINT_PARTNER_DATA_DIR` | `./data` (`/data` in Docker) | SQLite DB, synced repos, exports, thumbnails |
| `HOST` | `127.0.0.1` (`0.0.0.0` in Docker) | Bind address |
| `PORT` | `18765` (dev) / `8080` (Docker) | HTTP port |
| `STATIC_DIR` | unset | When set, the server also serves the built SPA from this directory (single-port mode) |
| `DEPLOY_MODE` | `self-host` | `self-host` or `saas` |
| `MULTI_USER` | `0` (self-host) / `1` (saas default) | Enable login, per-user data, and in-app sharing |
| `SESSION_SECRET` | unset | Required when `MULTI_USER=1` or OAuth in production |
| `SMTP_HOST` / `SMTP_FROM` | unset | Send password reset emails (see [`web/DEPLOY.md`](web/DEPLOY.md)) |
| `APP_PUBLIC_URL` | unset | Public URL for reset links when behind a reverse proxy |
| `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` / `GITHUB_CALLBACK_URL` | unset | GitHub OAuth |
| `DISCORD_CLIENT_ID` / `DISCORD_CLIENT_SECRET` / `DISCORD_CALLBACK_URL` | unset | Discord OAuth |
| `CORS_ORIGIN` / `ALLOWED_ORIGINS` | `true` | Allowed CORS origin(s); comma-separated list for multiple (`ALLOWED_ORIGINS` takes precedence) |
| `BASIC_AUTH_USER` / `BASIC_AUTH_PASS` | unset | Optional HTTP Basic protection |
| `UPLOAD_MAX_BYTES` | `536870912` | Multipart upload / request body limit (512 MiB) |
| `PP_VERSION` | `3.0.0-web` (baked into release images) | Version reported by `GET /health` |
| `PRINT_PARTNER_UPDATE_CHECK` | enabled | Set to `0` to disable in-app update checks |
| `GITHUB_REPO` | `poitee/PrintPartnerPartner` | GitHub repo for release lookup |
| `PRINT_PARTNER_LATEST_VERSION` | unset | Air-gapped: compare against this version instead of GitHub |
| Kit advisor (`AI_*`, `SEARCH_*`, Ollama, …) | unset | **Prefer Settings → AI assistant.** Env is operator/SaaS fallback only — full table in [`web/DEPLOY.md`](web/DEPLOY.md) |

The app optionally checks GitHub for newer releases and shows a subtle banner plus **Settings → About & updates**. Self-host Docker upgrade: `docker compose pull && docker compose up -d`.

See [`web/DEPLOY.md`](web/DEPLOY.md) for the full reference, including SaaS variables, kit-advisor env, search backends, and desktop-data migration.

---

## Run locally without Docker

**Requirements:** Node 22.

```bash
cd web
npm ci
npm run dev
```

`npm run dev` runs a **predev** step that builds `@print-partner/contracts` and `@print-partner/domain` before starting the API and UI. On a fresh clone, `npm ci && npm run dev` is enough — you do not need a separate `npm run build` first.

- **UI** (Vite) — [http://127.0.0.1:5173](http://127.0.0.1:5173)
- **API** (Fastify) — [http://127.0.0.1:18765](http://127.0.0.1:18765) (`/health`)

### Production-like single-port run

Build everything, then run the server with `STATIC_DIR` pointing at the built SPA so the API and UI share one port:

```bash
cd web
npm ci
npm run build
STATIC_DIR="$(pwd)/apps/web/dist" PORT=8080 HOST=127.0.0.1 \
  node apps/server/dist/index.js
```

Open [http://localhost:8080](http://localhost:8080).

---

## SaaS mode

Set `DEPLOY_MODE=saas` to enable multi-tenant hosting: Postgres for app data (when `DATABASE_URL` is set), S3-compatible blob storage (when `S3_BUCKET` is set), and GitHub OAuth. A ready-to-run stack with Postgres 16 and RustFS (S3-compatible) is provided:

```bash
docker compose -f docker-compose.saas.yml up --build
```

See [`web/DEPLOY.md`](web/DEPLOY.md) for SaaS environment variables, auth routes, and S3 configuration.

---

## Architecture / monorepo layout

The application lives in the `web/` TypeScript monorepo; the `Dockerfile` and Compose files stay at the repository root.

| Package | Path | Role |
|---------|------|------|
| `@print-partner/web` | `web/apps/web` | Vite + React single-page app |
| `@print-partner/server` | `web/apps/server` | Fastify API (also serves the SPA in single-port mode) |
| `@print-partner/contracts` | `web/packages/contracts` | Shared API types |
| `@print-partner/domain` | `web/packages/domain` | Framework-agnostic domain logic |

```text
.
├── Dockerfile                 # self-host image (API + SPA, single port)
├── docker-compose.yml         # self-host (SQLite, port 8080)
├── docker-compose.saas.yml    # SaaS (Postgres + RustFS/S3 + OAuth)
└── web/
    ├── apps/web               # React SPA
    ├── apps/server            # Fastify API
    └── packages/              # contracts, domain
```

The server uses a **ports/adapters** design: a `self-host` adapter (SQLite + local disk) and a `saas` adapter (Postgres + S3) implement the same ports. STL rendering happens client-side with Three.js, and long-running work (sync, recompute, exports) runs in a background job runner that streams progress over a WebSocket. See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for details.

---

## Support

If Print Partner saves you time on a kit build, **[GitHub Sponsors](https://github.com/sponsors/poitee)** helps fund development. Sponsorships are voluntary and do not grant commercial license rights — see [LICENSE-SUMMARY.md](LICENSE-SUMMARY.md).

---

## License & attribution

Print Partner is licensed under the **[Creative Commons Attribution-NonCommercial 4.0 International License (CC BY-NC 4.0)](LICENSE)**. Plain-language summary: [LICENSE-SUMMARY.md](LICENSE-SUMMARY.md).

Print Partner builds on work shared by the **3D Printing Community** and by **[ThunderKeys' STL Manifest Generator](https://github.com/thunderkeys/stl-manifest-generator)** — see [ATTRIBUTION.md](ATTRIBUTION.md).

- **[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)** — bundled dependency notices

---

## Links

- [Project site (GitHub Pages)](https://poitee.github.io/PrintPartnerPartner/) — landing page with workflow screenshots
- [`docs/INSTALL.md`](docs/INSTALL.md) — beginner Docker install and first run
- [`docs/KIT_ADVISOR.md`](docs/KIT_ADVISOR.md) — kit advisor: Anthropic, OpenAI, or local Ollama
- [`web/DEPLOY.md`](web/DEPLOY.md) — Docker Compose, env vars, SaaS, kit-advisor operator reference
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — system design
- [`docs/API.md`](docs/API.md) — HTTP API overview (including `/assistant/*`)
- [`CHANGELOG.md`](CHANGELOG.md) — release history
- [`LICENSE`](LICENSE) — full license text
