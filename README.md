<p align="center">
  <img src="docs/logo.png" alt="Print Partner logo" width="128" />
</p>

<h1 align="center">Print Partner</h1>

<p align="center">
  <strong>Self-hostable desk workflow for layered STL kits</strong><br>
  Sync kit repos, compose a plan, pack plates, export, and check off prints — one Docker container on your LAN.
</p>

<p align="center">
  <a href="https://github.com/sponsors/poitee"><img src="https://img.shields.io/badge/GitHub_Sponsors-Sponsor-ea4aaa?style=for-the-badge&logo=github-sponsors&logoColor=white" alt="Sponsor on GitHub Sponsors"></a>
</p>

<p align="center">
  <a href="https://poitee.github.io/PrintPartnerPartner/">Project site</a>
  ·
  <a href="#quick-start--docker-self-host">Quick start</a>
  ·
  <a href="#attach-mcp-cursor--grok--claude">Attach MCP</a>
  ·
  <a href="#screenshots">Screenshots</a>
  ·
  <a href="docs/ARCHITECTURE.md">Architecture</a>
  ·
  <a href="LICENSE-SUMMARY.md">License</a>
</p>

<p align="center">
  <code>Library</code> → <code>Plan</code> → <code>Parts</code> → <code>Progress</code> → <code>Export</code>
</p>

<p align="center">
  <sub>
    Manage plans from the header <strong>Create plan</strong> control or the sidebar <strong>Plans</strong> page.
    Print checkoff lives on <strong>Progress</strong> (legacy <code>/checkoff</code> redirects there).
    Utility nav: Plans · Printers · Settings · Help.
  </sub>
</p>

<p align="center">
  <sub>
    Ships as a single Docker container — <strong>Fastify</strong> API + <strong>React</strong> SPA on port <strong>8080</strong>.
    Brand theme with <strong>light</strong>, <strong>dark</strong>, or <strong>system</strong> preference. Data stays in a volume you control.
    Attach <strong>Cursor / Grok / Claude</strong> over HTTP MCP (kit brain; confirm-to-apply — no in-app Kit Advisor).
    Multi-tenant <strong>SaaS</strong> mode includes S3 + OAuth; its Postgres compatibility bridge remains experimental.
  </sub>
</p>

---

## What it does

| Step | What you are doing |
|------|--------------------|
| **Library** | Add GitHub repos, local folders, or zips; assign categories; search STLs across every synced repo; see **update available** badges; sync and set import rules. |
| **Plan** | Attach base/add-on sources, pick STL files, set **role filament colors** (previews update live), recompute when stale, kit/manifest options, inline repo **Docs**. |
| **Parts** | Confirm validation by role and filament, browse included parts with 3D previews, edit quantities. |
| **Progress** | Track **print checkoff** (per-unit progress, assembled toggles, filters, printable checklist). |
| **Export** | Plate workspace, height-band packing, slicer links, profile library, STL/3MF packs, printer bind / send, Spoolman deduct when configured. |

**Plans** (not a pipeline step): create, rename, duplicate, archive, and delete plans from **Create plan** or the **Plans** page. The active plan is shared across Plan, Parts, Progress, and Export.

**MCP attach:** Print Partner is the kit brain. Connect Cursor / Grok / Claude to HTTP MCP (`/api/v1/mcp` + `PRINT_PARTNER_API_KEY`). Mutations stay confirm-to-apply. Guide: [`docs/assistant-mcp.md`](docs/assistant-mcp.md). There is **no in-app Ask / Kit Advisor sheet** and **no Settings → AI**.

**Tips:** **⌘K / Ctrl+K** opens the command palette (sync, recompute, exports, navigation). Collapse the left spine to an icon rail. Open **Help** for the full workflow guide.

Optional integrations:

- **[Spoolman](docs/integrations/SPOOLMAN.md)** — pick filaments from inventory on Plan; read-only remaining weights in Parts; optional deduct on send.
- **Live printers** — **Klipper/Moonraker** and **PrusaLink** support test, status, and G-code upload with verify-first Progress; **Bambu** LAN MQTT is status-only (send deferred). See **[Printer setup](docs/integrations/PRINTER_SETUP.md)**.
- **Slicer sidecar** — optional Orca/Prusa/Bambu CLI companion for auto-slice (`slicer-sidecar/`, `pp-compose.yml`).
- **Discord digest / Home Assistant** — optional overnight farm digest and HA hooks when configured.
- **Backups, metrics, rate limits, API keys** — see [`OPERATIONS.md`](OPERATIONS.md).

---

## Attach MCP (Cursor / Grok / Claude)

Print Partner exposes product tools over **streamable HTTP MCP** on the running host.

| | |
|--|--|
| URL | `https://<host>/api/v1/mcp` (remote) · `http://127.0.0.1:<port>/api/v1/mcp` (loopback/tunnel only) |
| Auth | `PRINT_PARTNER_API_KEY` required when `HOST` is not loopback |
| Cursor plugin | [`cursor-plugin/print-partner`](cursor-plugin/print-partner) |
| Connect guide | [`docs/assistant-mcp.md`](docs/assistant-mcp.md) |
| Kit brain notes | [`docs/KIT_ADVISOR.md`](docs/KIT_ADVISOR.md) |

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

### Plans

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/screenshots/dark/builds.png">
  <source media="(prefers-color-scheme: light)" srcset="docs/screenshots/light/builds.png">
  <img src="docs/screenshots/light/builds.png" alt="Plans — plan manager with create, rename, duplicate, and archive.">
</picture>

Sidebar **Plans** page plus **Create plan** in the header spine.

### Plan

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/screenshots/dark/build.png">
  <source media="(prefers-color-scheme: light)" srcset="docs/screenshots/light/build.png">
  <img src="docs/screenshots/light/build.png" alt="Plan — role filament colors, STL pickers with live preview, and recompute.">
</picture>

Role colors, attach sources, pick STLs (live 3D preview), recompute when stale, kit options, **Docs**.

### Parts

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/screenshots/dark/review.png">
  <source media="(prefers-color-scheme: light)" srcset="docs/screenshots/light/review.png">
  <img src="docs/screenshots/light/review.png" alt="Parts — validation, parts with 3D previews, quantity edits.">
</picture>

Validation by role and filament, parts list with **3D previews**, quantity edits.

### Progress & Export

Print checkoff lives on **Progress**. Plate packing, slicer links, profile library, and send live on **Export**. Re-run `docs/scripts/capture-screenshots.mjs` to refresh PNGs for those stages.

---

## Quick start — Docker self-host

**Requirements:** Docker with Compose v2.

From the repository root, pull the pre-built image from GitHub Container Registry and start it:

```bash
docker compose pull && docker compose up -d
```

Open [http://localhost:8080](http://localhost:8080). Data persists in the `print-partner-data` volume, mounted at `/data` inside the container (SQLite database, synced repos, exports, and thumbnails).

Images are published to **`ghcr.io/poitee/print-partner`** (`latest` plus a tag
per release, e.g. `3.1.0`). Compose defaults to the audited `3.1.0` tag; set
`PRINT_PARTNER_VERSION` to another release explicitly. To build from source
instead:

```bash
docker compose up --build
```

**LAN Docker host tip:** replace `localhost` with the host’s LAN IP (e.g. `http://192.168.x.x:8080`) from other machines on the network. Keep `PRINT_PARTNER_API_KEY` set if you expose MCP beyond loopback.

**New to Docker?** See the step-by-step guide in [`docs/INSTALL.md`](docs/INSTALL.md). Quick checklist:

1. Install [Docker Desktop](https://docs.docker.com/get-docker/) (or Docker Engine + Compose on Linux) and verify `docker compose version`.
2. Clone this repo and `cd` into it.
3. Run `docker compose pull && docker compose up -d` (or `docker compose up --build` to build from source).
4. Open [http://localhost:8080](http://localhost:8080) (or `http://<lan-ip>:8080`).
5. Add a source on **Library**, create a plan with **Create plan** or **Plans**, then walk **Plan → Parts → Progress → Export**.
6. For MCP attach on Docker (`HOST=0.0.0.0`): set `PRINT_PARTNER_API_KEY`, prefer HTTPS via a reverse proxy, then connect via [`docs/assistant-mcp.md`](docs/assistant-mcp.md).

Optional slicer GUI + sidecar stack (profiles + auto-slice): `docker compose -f docker-compose.yml -f pp-compose.yml up -d` — see comments in `pp-compose.yml`.

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
| `PP_VERSION` | `3.1.0-web` (baked into release images) | Version reported by `GET /health` |
| `PRINT_PARTNER_UPDATE_CHECK` | enabled | Set to `0` to disable in-app update checks |
| `GITHUB_REPO` | `poitee/PrintPartnerPartner` | GitHub repo for release lookup |
| `PRINT_PARTNER_LATEST_VERSION` | unset | Air-gapped: compare against this version instead of GitHub |
| `PRINT_PARTNER_API_KEY` | unset | Gates `/api/v1/*` when set; **required** for `/api/v1/mcp` unless `HOST` is loopback |

The app optionally checks GitHub for newer releases and shows a subtle banner plus **Settings → About & updates**. Self-host Docker upgrade: `docker compose pull && docker compose up -d`.

See [`web/DEPLOY.md`](web/DEPLOY.md) for the full reference, including SaaS variables, MCP attach, and desktop-data migration. Day-two ops (backups, API keys, metrics, rate limits): [`OPERATIONS.md`](OPERATIONS.md).

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

Set `DEPLOY_MODE=saas` to enable the multi-tenant adapter, S3-compatible blob storage (when `S3_BUCKET` is set), and GitHub OAuth. The Postgres repository path is currently experimental because its synchronous compatibility bridge does not provide native transaction semantics; production startup requires the explicit `POSTGRES_EXPERIMENTAL=1` acknowledgement. SQLite remains the supported database. A development stack with Postgres 16 and RustFS (S3-compatible) is provided:

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
├── pp-compose.yml             # optional slicer GUIs + sidecar + profile volumes
├── slicer-sidecar/            # Flask/Waitress Orca CLI companion
└── web/
    ├── apps/web               # React SPA
    ├── apps/server            # Fastify API
    └── packages/              # contracts, domain
```

The server uses a **ports/adapters** design: a `self-host` adapter (SQLite + local disk) and a `saas` adapter (Postgres + S3) implement the same ports. STL rendering happens client-side with Three.js, and long-running work (sync, recompute, exports, auto-slice) runs in a background job runner that streams progress over a WebSocket. See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for details.

---

## Support

If Print Partner saves you time on a kit build, **[GitHub Sponsors](https://github.com/sponsors/poitee)** helps fund development. Sponsorships are voluntary and do not grant commercial license rights — see [LICENSE-SUMMARY.md](LICENSE-SUMMARY.md).

---

## License & attribution

Print Partner is licensed under the **[Creative Commons Attribution-NonCommercial 4.0 International License (CC BY-NC 4.0)](LICENSE)**. Plain-language summary: [LICENSE-SUMMARY.md](LICENSE-SUMMARY.md).

Print Partner builds on **[ThunderKeys' STL Manifest Generator](https://github.com/thunderkeys/stl-manifest-generator)** — see [ATTRIBUTION.md](ATTRIBUTION.md).

- **[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)** — bundled dependency notices

Credits (people only): **Chad Lynch** ([@poitee](https://github.com/poitee)), **ThunderKeys** ([@thunderkeys](https://github.com/thunderkeys)).

---

## Links

- [Project site (GitHub Pages)](https://poitee.github.io/PrintPartnerPartner/) — landing page with workflow screenshots
- [`docs/INSTALL.md`](docs/INSTALL.md) — beginner Docker install and first run
- [`docs/assistant-mcp.md`](docs/assistant-mcp.md) — attach Cursor / Grok / Claude via HTTP MCP
- [`docs/KIT_ADVISOR.md`](docs/KIT_ADVISOR.md) — kit brain + MCP (no in-app AI)
- [`web/DEPLOY.md`](web/DEPLOY.md) — Docker Compose, env vars, SaaS, MCP attach
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — system design
- [`docs/API.md`](docs/API.md) — HTTP API overview (`/api/v1`, MCP)
- [`OPERATIONS.md`](OPERATIONS.md) — backups, API keys, metrics, day-two ops
- [`CHANGELOG.md`](CHANGELOG.md) — release history
- [`LICENSE`](LICENSE) — full license text
