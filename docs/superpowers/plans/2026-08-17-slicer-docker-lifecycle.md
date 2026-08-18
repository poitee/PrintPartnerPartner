# Slicer Docker Lifecycle (Plan 3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let Settings → Slicers start/stop/pull slicer containers and show status/logs for instances labeled as Print Partner–owned, across `local`, `pp_compose`, and `remote` Docker targets (self-host only).

**Architecture:** Introduce a server-side Docker adapter (`dockerode` + thin compose CLI for `pp_compose`) that only operates on containers labeled `printpartner.slicer_instance_id=<id>`. Extend `/slicer-instances/:id/*` with pull/start/stop/status/logs; update `status_cache` / `status_message` after ops. Settings UI gains Docker controls when `DEPLOY_MODE !== saas`. Stock presets prefill image/ports/volumes from `pp-compose.yml` defaults. No browser access to the Docker socket.

**Tech Stack:** TypeScript monorepo (`web/`), Vitest, Fastify, React, `dockerode` (Docker Engine API), optional `docker compose` CLI for pp_compose.

**Spec:** `docs/superpowers/specs/2026-08-17-slicer-hub-profile-assignment-design.md` — ship step 3 only.

**Deferred:** Plan 4 export plate handoff; native slicer projects; SaaS-hosted Docker.

## Global Constraints

- Preserve 3MF `object@name` = STL basename / `name (n)` — no export-3mf changes.
- **Only** operate on containers with label `printpartner.slicer_instance_id=<instanceId>`; refuse unlabeled / foreign containers.
- SaaS `DEPLOY_MODE=saas`: Docker management API returns **403**; UI hides Start/Stop/Pull/Logs.
- Credentials for remote Docker stay server-side (`docker_host` / env); never send socket secrets to the SPA.
- Do not request ThunderKeys for review; do not use Snyk.
- Run Node commands from `web/`.
- YAGNI: no kubernetes orchestration, no auto-heal loops, no image build UI, no unbounded log streaming WebSockets (bounded tail only).

## File map

| File | Responsibility |
|------|----------------|
| `web/apps/server/package.json` | Add `dockerode` (+ `@types/dockerode` if needed) |
| `web/apps/server/src/services/slicer-docker.ts` | Adapter interface + Engine/compose implementations + label helpers |
| `web/apps/server/src/services/slicer-docker.test.ts` | Fake adapter + label/refuse tests |
| `web/apps/server/src/services/slicer-docker-presets.ts` | Stock image/ports/volumes defaults (from pp-compose) |
| `web/apps/server/src/routes/slicer-instances.ts` | Add lifecycle routes; gate SaaS |
| `web/apps/server/src/routes/slicer-instances.test.ts` | Inject tests with fake Docker |
| `web/apps/server/src/db/repository.ts` | `updateSlicerInstanceStatus` helper if useful |
| `web/apps/server/src/config.ts` | Optional `DOCKER_HOST`, `PP_COMPOSE_FILE`, feature flags |
| `web/apps/web/src/api/engine.ts` | Client helpers for lifecycle endpoints |
| `web/apps/web/src/components/settings/SlicersSettingsCard.tsx` | Status pill + Pull/Start/Stop/Logs (self-host) |
| `docs/API.md` / `docs/ARCHITECTURE.md` | Document lifecycle routes + safety labels |

---

### Task 1: Docker adapter contract + fake (TDD)

**Files:**
- Create: `web/apps/server/src/services/slicer-docker.ts`
- Create: `web/apps/server/src/services/slicer-docker.test.ts`

**Interfaces:**

```ts
export type DockerTarget = "local" | "pp_compose" | "remote";

export type SlicerContainerSpec = {
  instanceId: string;
  name: string;
  image: string;
  containerName: string;
  dockerTarget: DockerTarget;
  dockerHost?: string | null;
  composeService?: string | null;
  ports: Array<{ host: number; container: number; protocol?: "tcp" | "udp" }>;
  volumes: Array<{ host: string; container: string; mode?: "ro" | "rw" }>;
  env: Record<string, string>;
};

export type SlicerDockerStatus = {
  state: "running" | "stopped" | "unknown" | "error" | "missing";
  message: string | null;
  containerId: string | null;
};

export type SlicerDockerAdapter = {
  refreshStatus(spec: SlicerContainerSpec): Promise<SlicerDockerStatus>;
  pull(spec: SlicerContainerSpec): Promise<SlicerDockerStatus>;
  start(spec: SlicerContainerSpec): Promise<SlicerDockerStatus>;
  stop(spec: SlicerContainerSpec): Promise<SlicerDockerStatus>;
  logs(spec: SlicerContainerSpec, opts?: { tail?: number }): Promise<{ lines: string[] }>;
};

export const SLICER_INSTANCE_LABEL = "printpartner.slicer_instance_id";
```

- Fake adapter in tests records calls and enforces label checks when inspecting a synthetic registry.
- Pure helpers: `parsePortsJson` / `parseVolumesJson` / `parseEnvJson` with safe defaults; `specFromInstanceRow(row)`.

- [ ] **Step 1: Write failing tests** for label constant, JSON parsers, fake start/stop/status
- [ ] **Step 2: Run — FAIL**
- [ ] **Step 3: Implement contract + fake + parsers**
- [ ] **Step 4: Run — PASS**
- [ ] **Step 5: Commit** `feat(server): add slicer Docker adapter contract and fake`

---

### Task 2: Engine-backed adapter (local / remote)

**Files:**
- Modify: `web/apps/server/package.json` — add `dockerode`
- Modify: `slicer-docker.ts` — `createEngineDockerAdapter(dockerHost?: string)`

**Behavior:**
1. Connect via `dockerode` using `dockerHost` or env `DOCKER_HOST` or default socket.
2. `refreshStatus`: find container by label filter; if missing → `missing`; if found without matching label → refuse (`error`).
3. `pull`: `docker.pull(image)`; update status after.
4. `start`: if missing, create with labels + ports/volumes/env + `container_name`; then start. If exists but wrong label → refuse. If stopped → start.
5. `stop`: stop labeled container only.
6. `logs`: `logs({ stdout: true, stderr: true, tail: N })` default N=200, max 500; return string lines.

Unit tests: mock dockerode client OR keep Engine path behind injectable factory and unit-test factory wiring with fake.

- [ ] **Step 1: Add dependency**
- [ ] **Step 2: Implement Engine adapter with injectable client factory**
- [ ] **Step 3: Tests for refuse-unlabeled + create-with-label**
- [ ] **Step 4: Commit** `feat(server): Docker Engine adapter for slicer instances`

---

### Task 3: pp_compose target

**Files:** `slicer-docker.ts`, tests, maybe `config.ts`

**Behavior:**
- Resolve compose file: `PP_COMPOSE_FILE` or repo-root `pp-compose.yml` (path via `config` / `process.cwd()` / env).
- Prefer Engine API by compose service labels when possible; else `docker compose -f <file> …` for `up -d <service>` / `stop <service>` / `pull <service>`.
- Still require the running container to carry `printpartner.slicer_instance_id` **or** set that label when PP creates/adopts the service container (document: for stock compose services, `start` may `compose up` then label via Engine `container.update` / recreate with labels — prefer recreate-with-labels for owned services).
- If compose service name missing on instance → 400.

Pragmatic v1: for `pp_compose`, run compose CLI for pull/start/stop against `compose_service`, then refresh status via Engine label query; if container exists without label after up, attempt to set label once (or recreate). Tests stub `execFile` / Engine.

- [ ] **Step 1–4: Implement + test**
- [ ] **Step 5: Commit** `feat(server): pp_compose target for slicer Docker lifecycle`

---

### Task 4: Lifecycle HTTP API

**Files:** `routes/slicer-instances.ts`, tests, `app`/`config` wiring

**Routes** (self-host only; SaaS → 403 `{ detail: "Docker management disabled in saas mode" }`):

| Method | Path | Action |
|--------|------|--------|
| `GET` | `/slicer-instances/:id/docker-status` | refresh + persist `status_cache` |
| `POST` | `/slicer-instances/:id/docker-pull` | pull |
| `POST` | `/slicer-instances/:id/docker-start` | start |
| `POST` | `/slicer-instances/:id/docker-stop` | stop |
| `GET` | `/slicer-instances/:id/docker-logs?tail=200` | bounded logs |

Require `image` (and for pp_compose, `compose_service`) before start/pull — 400 with clear detail.

Wire adapter selection from instance `docker_target` + `docker_host`.

- [ ] **Step 1: Failing inject tests** (fake adapter injected via deps)
- [ ] **Step 2–4: Implement + PASS**
- [ ] **Step 5: Commit** `feat(api): slicer instance Docker lifecycle endpoints`

---

### Task 5: Presets fill Docker fields + Settings UI

**Files:**
- `slicer-docker-presets.ts` / extend `stockPresets` to include `image`, `container_name`, default ports/volumes JSON
- `SlicersSettingsCard.tsx` — status pill; Pull / Start / Stop; Logs dialog; edit docker_target / image / container_name when self-host
- `engine.ts` client helpers
- Health or settings endpoint already exposing `deploy_mode` — reuse for gating UI

Seeded stock rows: backfill image/container defaults on seed if empty (optional migration helper in seed path — only when fields blank).

- [ ] **Step 1–4: UI + client + preset defaults**
- [ ] **Step 5: Commit** `feat(web): slicer Docker controls in Settings`

---

### Task 6: Docs + verification

- Update `docs/API.md` lifecycle routes + label safety note
- Update `docs/ARCHITECTURE.md` one bullet: Slicer Hub Docker lifecycle (self-host)
- Spec status: Plans 1–3 shipped / Plan 3 in progress → Plan 3 done when merged

```bash
cd web && npx vitest run apps/server/src/services/slicer-docker.test.ts \
  apps/server/src/routes/slicer-instances.test.ts
cd web && npm run typecheck
```

- [ ] Commit docs `docs: document slicer Docker lifecycle API`

---

## Self-review vs spec step 3

| Spec item | Task |
|-----------|------|
| local / pp_compose / remote targets | 2–3 |
| pull / start / stop / status / logs | 2–4 |
| Label ownership enforcement | 1–2 |
| SaaS disabled | 4–5 |
| Settings Start/Stop/Pull/Logs | 5 |
| Export plate handoff | Deferred Plan 4 |

## Suggested follow-ups after Plan 3 merges

- **Plan 4:** Export plate → Download / managed Open / deep-link
- Optional: live log WebSocket; compose project discovery UI
