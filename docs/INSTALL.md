# Install Print Partner with Docker

This guide is for **first-time Docker users** who want to run Print Partner on a home or shop network. It covers install, first run, where your data lives, and common fixes.

For environment variables, SaaS mode, and production tuning, see [`web/DEPLOY.md`](../web/DEPLOY.md).

---

## What you need

- A computer (Mac, Windows, or Linux) on your LAN — a desktop, mini PC, or homelab server works fine.
- **Docker** — packages the app and its dependencies so you do not need to install Node.js or build tools yourself.
- A web browser on the same network (or on the same machine).

Print Partner runs as a **single container**: one command starts the API and web UI together on port **8080**. Your synced repos, plans, and exports stay in a **Docker volume** that survives container restarts.

---

## Install Docker

### Mac or Windows

1. Download **[Docker Desktop](https://docs.docker.com/get-docker/)** and install it.
2. Open Docker Desktop and wait until it reports that the engine is running.
3. Verify in a terminal:

```bash
docker --version
docker compose version
```

Both commands should print version numbers (Compose v2 is required).

### Linux

Install Docker Engine and the Compose plugin using your distribution’s package manager or the [official Docker docs](https://docs.docker.com/engine/install/). On Ubuntu/Debian, `docker.io` plus the `docker-compose-v2` plugin is a common choice.

Add your user to the `docker` group if you get “permission denied” on `/var/run/docker.sock`:

```bash
sudo usermod -aG docker "$USER"
```

Log out and back in, then verify with `docker --version` and `docker compose version`.

---

## Get the code

**With Git** (recommended for updates):

```bash
git clone https://github.com/poitee/PrintPartnerPartner.git
cd PrintPartnerPartner
```

**Without Git:** open the [GitHub repository](https://github.com/poitee/PrintPartnerPartner), choose **Code → Download ZIP**, extract it, and `cd` into the folder in a terminal.

---

## First run

From the repository root, pull the pre-built image and start it in the background:

```bash
docker compose pull && docker compose up -d
```

- Docker downloads the published image from `ghcr.io/poitee/print-partner` — no compiling needed.
- Once the container is up, open **[http://localhost:8080](http://localhost:8080)** in your browser.
- Watch logs with `docker compose logs -f`.

**Prefer to build from source?** Run `docker compose up --build` instead. The first build can take several minutes, and the terminal stays attached showing server logs — that is normal.

---

## First-time app tour

Print Partner follows a five-step pipeline:

1. **Sources** — Add GitHub repos, local folders, or zip archives. Assign categories, set import rules, and sync STLs.
2. **Builds** — Create, rename, duplicate, and delete **plans**. The header dropdown picks which plan Build, Review, and Checkoff use.
3. **Build** — Attach sources to the active plan, pick role filament colors, choose files and quantities, and **Update build**.
4. **Review** — Validate totals by role and filament, browse 3D previews, and **Export STLs**.
5. **Checkoff** — Track per-unit print progress, print a checklist, or **Export missing STLs** for the next batch.

Use the **sidebar** to move between steps. The **theme** control (light, dark, or system) is at the bottom of the sidebar.

**Tip:** After the first load, always navigate with the sidebar. Pasting `/sources` or `/build` directly into the address bar on a cold load can hit API routes and show raw JSON instead of the UI.

---

## Your data

Self-host Docker stores everything in the **`print-partner-data`** volume:

- SQLite database (plans, sources, checkoff state)
- Synced repository files
- Exports and thumbnails

Data **persists across restarts**. `docker compose down` stops the container but **does not delete** the volume.

Inspect the volume:

```bash
docker volume inspect print-partner-data
```

For backups, copy the volume contents while the container is stopped, or use your usual Docker backup workflow. The exact mount path on the host depends on your Docker setup.

---

## Day-two operations

### Stop the app

- **Foreground run:** press `Ctrl+C` in the terminal, then optionally `docker compose down`.
- **Detached run:** `docker compose down`.

### Update to a new release

```bash
git pull
docker compose pull && docker compose up -d
```

Or, if you build from source: `git pull && docker compose up --build -d`.

### Change the port

Edit `docker-compose.yml` and change the host port mapping, for example `9090:8080`, then open `http://localhost:9090`.

---

## Troubleshooting

### Port 8080 already in use

Another app is bound to 8080. Change the mapping in `docker-compose.yml` (see above) or stop the conflicting service.

### Page shows blank JSON instead of the UI

You opened an API path (e.g. `/sources`) with a full page load. Go to `http://localhost:8080/` and use the **sidebar** to navigate.

### Docker Desktop is not running

On Mac/Windows, start Docker Desktop and wait until the engine is ready before running `docker compose up`.

### Windows: WSL2 issues

Docker Desktop on Windows uses WSL2. Ensure WSL2 is enabled and Docker Desktop’s WSL integration is turned on for your distro. See [Docker Desktop for Windows](https://docs.docker.com/desktop/setup/install/windows-install/).

### Linux: permission denied on docker.sock

Add your user to the `docker` group (see Install Docker above) or run commands with `sudo` (less ideal for daily use).

### Cannot reach the app from another device on the LAN

The default Compose file publishes port 8080 on all interfaces. Check your host firewall allows inbound TCP 8080. Use `http://<your-server-ip>:8080` from other machines.

### Build fails or container exits immediately

Read the log output from `docker compose logs` (or `docker compose up --build` when building from source). Ensure you have enough disk space and a working internet connection for the first pull or build.

---

## Alternatives

| Goal | Where to go |
|------|-------------|
| Run without Docker (Node 22, hot reload) | [README — Run locally without Docker](../README.md#run-locally-without-docker) |
| Full env var reference, SaaS, API keys | [`web/DEPLOY.md`](../web/DEPLOY.md) |
| Architecture and design | [`docs/ARCHITECTURE.md`](ARCHITECTURE.md) |

---

## Quick checklist

1. Install Docker and verify `docker compose version`.
2. Clone or download this repository.
3. Run `docker compose pull && docker compose up -d` from the repo root (or `docker compose up --build` to build from source).
4. Open [http://localhost:8080](http://localhost:8080).
5. Add a **Source**, create a **Build** plan, and walk through the pipeline.

Need more detail on any step? Open an issue on [GitHub](https://github.com/poitee/PrintPartnerPartner/issues) or read the [README](../README.md).
