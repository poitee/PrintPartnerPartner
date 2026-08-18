# Task 6 report: CI, release, manifests, dependencies, and documentation

## Status

Complete on `cursor/full-codebase-audit-2c41`.

Implementation HEAD before this report:
`19d8929904817ce030bf939bcfd75bd7034b724d`.

## Audit checklist

- [x] **Web CI production build and browser accessibility:** `web-ci.yml`
  installs with `npm ci`, enforces the high-severity audit, runs the reusable
  `npm run quality` sequence (lint, typecheck, unit/integration tests,
  production build, browser skip-link test), and caches the lockfile with
  Node 22.
- [x] **Docker/deploy CI and Compose validation:** deploy-file path filters
  trigger Web CI. Its Docker job validates self-host, SaaS, and slicer-overlay
  Compose configurations, builds the production image, starts it, and runs the
  real workflow smoke script.
- [x] **Release quality gate:** tag publishing now depends on both the reusable
  Web CI workflow and reusable manifest workflow before registry login, image
  publication, or GitHub Release creation.
- [x] **Real versioned manifest validation:** the Python validator selects the
  Draft 2020-12 v1 or v2 JSON Schema from the integer `version`, rejects
  unsupported versions, validates all canonical community manifests, parses
  repository YAML, and reports field paths.
- [x] **Manifest single source and drift:** canonical files under `manifests/`
  drive `--sync-embedded`; tests and PR/main CI reject missing, orphaned, or
  byte-drifted server copies. Server builds now copy those runtime assets into
  `dist`.
- [x] **Manifest PR and main-push coverage:** manifest CI runs on pull requests,
  pushes to `main`, and reusable release calls, including changes to embedded
  copies and the workflow itself.
- [x] **Dependency automation and audit:** Dependabot covers npm, pip,
  GitHub Actions, the root Dockerfile, and the slicer-sidecar Dockerfile.
  Web CI blocks high/critical npm findings.
- [x] **Node 22 contract:** `.nvmrc`, package `engines`, CI, Docker, and docs
  agree on Node 22.
- [x] **Action alignment:** checkout is consistently v4; setup-node v4,
  setup-python v5, current Docker v3/v6 actions, Pages actions, and release v2
  remain on their appropriate maintained majors.
- [x] **Package hygiene:** Dockerode and Nodemailer type packages moved to
  development dependencies; Node typings target the Node 22 line; every
  workspace resolves one physical Vite 8.2.1 installation instead of parallel
  Vite 6/8 majors.
- [x] **Documentation:** corrected `npm ci` setup, local links, stale test-count
  text, v1/v2 manifest CI wording, experimental Postgres/SaaS status,
  development credential guidance, Snyk truth, release gates, and image
  pinning. `web/CHANGELOG.md` is now a stub pointing to the root changelog.
- [x] **Dead Copilot UI:** deleted the unreachable context and all subscribers,
  route-state handlers, focus/filter props, mocks, and comments. A repository
  regression test forbids the removed bridge residue.
- [x] **Compose hardening:** pinned Postgres 16.15, Alpine 3.21.3, RustFS
  1.0.0-rc.2, OrcaSlicer v2.4.2-ls32, and the available date-tagged PrusaSlicer
  image. Self-host Compose defaults to audited app release 3.0.0. SaaS
  credentials are clearly development-only and externally overrideable.
- [x] **Optional integration smoke:** a manually dispatched workflow can run a
  live Postgres adapter health test and, when selected, build and health-check
  the pinned OrcaSlicer sidecar.
- [x] **Workflow smoke integration:** the smoke script supports API-key auth,
  fails on errored/cancelled jobs, uses unique source names, uploads a real STL,
  recomputes one real part, changes progress, exports it, and verifies static
  assets.
- [x] **Build warnings:** migrated the Vite config away from `__dirname`,
  eliminated the duplicated Vite major, and documented a narrow 550 kB raw
  threshold for lazy-loaded Three.js (about 132 kB gzip) instead of leaving the
  default warning.

## TDD evidence

Manifest fixtures and tests were committed and pushed first (`77b6e20`). The
initial run failed because `manifests.scripts.validate` did not exist. After
implementation, six validator tests pass, covering valid/invalid v1 and v2,
unsupported versions, drift detection, repository drift, and canonical copy
generation.

The dead-Copilot regression was also committed first. Its corrected red run
reported 41 concrete source residues. After removal it passes with an empty
residue list. Typechecking then exposed three generic setters left behind by
the deletion; those were removed and the complete typecheck passed.

The first runtime workflow smoke exposed that a local source path is re-rooted
by the server and therefore produced no parts. The smoke now uses the supported
multipart upload endpoint. A second run created one STL part, marked its unit
complete, exported one file, and fetched the production static assets.

## Verification

- `npm ci`: passed; 759 packages installed from the lockfile.
- `npm audit --audit-level=high`: passed; zero high/critical findings. Four
  moderate development-only findings remain through `drizzle-kit`'s deprecated
  esbuild loader chain.
- `npm run lint`: passed with no diagnostics.
- `npm run typecheck`: passed for contracts, domain, server, and web.
- `npm test`: contracts 13, domain 127, web 353, and server 761 tests passed
  (1 server file / 2 tests skipped): 1,254 tests passed total.
- `npm run build`: passed for all workspaces; server runtime manifests were
  copied into `dist`, and Vite 8 produced the production SPA.
- `npm run test:browser`: passed against system Google Chrome.
- `python -m unittest manifests.tests.test_validate`: 6 tests passed.
- `python manifests/scripts/validate.py`: v1/v2 schema and drift validation
  passed.
- `actionlint`: all GitHub workflows passed.
- Workflow and Dependabot YAML also parsed successfully with PyYAML.
- `bash -n web/scripts/workflow-smoke.sh`: passed.
- Live workflow smoke against the production build: passed with one uploaded
  STL, one recomputed part, one progress update, one exported file, and three
  fetched asset bundles.
- Modified documentation local-link check: 6 files passed.
- `npm ls vite --all --parseable`: one physical Vite installation,
  `web/node_modules/vite`.
- Production dependency check for `@types/dockerode` and `@types/nodemailer`:
  empty.
- `git diff --check`: passed.

## Concerns

- Docker is not installed in this Cursor environment, so local
  `docker compose config`, production image build, SaaS stack, and sidecar
  container execution could not be run here. Those commands are wired into
  CI/manual workflows and passed static workflow validation.
- The remaining npm audit findings are moderate and confined to
  `drizzle-kit`'s development toolchain. npm's proposed remediation downgrades
  `drizzle-kit` to 0.18.1 as a breaking change, so it was not applied.
- Postgres remains explicitly experimental because its synchronous repository
  bridge lacks native transaction semantics. The optional live smoke confirms
  connectivity, not production-readiness.
- The PrusaSlicer noVNC image has no maintained semantic release stream; it is
  pinned to the newest available date tag rather than floating on `latest`.

## Review remediation (2026-08-18)

### Status and implementation SHA

All Critical, Important, Minor, and adjacent registry-parser findings are
resolved. Implementation HEAD before this report update:
`b0260a18935f606d684b204721f432467848aa4d`.

### Corrections

- Restored the `SourcesPage` consumer for `CommandPalette`'s
  `{ stlSearch: true }` navigation state. It expands and focuses the global STL
  search, consumes the state with a replace navigation, and does not restore
  any Copilot bridge.
- Replaced the broken line-oriented runtime registry parser with real YAML
  parsing and required-field validation. Quoted values and arbitrary field
  ordering now work.
- Added v2 `variant_dimensions` schema support and schema meta-validation via
  `Draft202012Validator.check_schema`.
- Hardened `workflow-smoke.sh`: every request fails on non-2xx responses, zero
  parts and zero exported files are fatal, and production pages must expose
  fetchable assets.
- Made the Postgres workflow production-config-valid with explicit
  `MULTI_USER=0` and `SESSION_SECRET`, and made it run automatically for
  relevant pull requests and main pushes.
- The live Postgres run exposed the pre-existing Promise/`Atomics.wait`
  deadlock in the experimental synchronous repository bridge. Postgres query
  builders now compile to SQL and execute through a synchronous child-process
  bridge, with Drizzle result mapping restored before repository consumers see
  rows.
- Aligned app, package, Docker, Compose, metrics, and documentation defaults on
  release `3.1.0` / `3.1.0-web`.
- SaaS Compose ports bind to `127.0.0.1` by default with explicit
  `PP_BIND_ADDRESS` override; development auth/session settings and override
  guidance are documented. Accurate optional Ollama environment comments are
  restored without claiming the removed in-app advisor UI exists.
- Updated OrcaSlicer to current LinuxServer release `v2.4.2-ls35`; main Docker
  CI now builds the sidecar, so its base image is pulled and validated on
  relevant changes.
- Dependabot PR counts are bounded. The unsafe all-npm mega-group is removed,
  while the Actions group is limited to minor/patch updates.
- Actionlint's ShellCheck findings are cleared.

### Test-first evidence

- Regression commit `83c857c` was pushed before implementation. The Sources
  route-state test could not find the STL search, registry parser tests
  reported the parser export missing, v2 validation rejected
  `variant_dimensions`, malformed schemas crashed validation, and three smoke
  harness scenarios incorrectly exited zero for no parts, no exports, and a
  500 asset.
- The first valid-env live Postgres run stalled after migrations. A focused
  bridge regression timed out under the old `Atomics.wait` implementation;
  the final synchronous-query regression now passes and the live server
  reaches health plus a Postgres-backed `/sources` query.

### Final verification

- `npm ci`: passed from the committed lockfile (759 packages).
- `npm run quality`: passed lint, all workspace typechecks, 1,258 unit and
  integration tests (13 contracts + 127 domain + 354 web + 764 server), four
  workflow-smoke guard tests, all production builds, and the real Chrome
  skip-link test.
- `npm audit --audit-level=high`: passed with zero high/critical findings.
- Manifest suite: 9 tests passed; repository schema and embedded-copy drift
  validation passed.
- `actionlint` with ShellCheck, direct `shellcheck`, workflow/Dependabot YAML,
  and all three Compose configurations passed.
- Production Docker image built successfully and reported `3.1.0-web`.
- Live production workflow smoke passed with one STL part, one progress
  update, one exported file, and three successful production assets.
- Live Postgres smoke passed with `driver=postgres`, `connected=true`,
  `support_status=experimental`, version `3.1.0-web`, and a successful
  Postgres-backed `/sources` query.
- Pinned OrcaSlicer `v2.4.2-ls35` pulled successfully, the sidecar image built,
  and its live health response reported the Orca binary exists.

### Remaining concerns

- Four moderate findings remain in `drizzle-kit`'s development-only deprecated
  esbuild loader chain. npm still proposes a breaking downgrade to
  `drizzle-kit@0.18.1`; no unsafe forced remediation was applied.
- Postgres remains experimental. The correctness bridge runs each synchronous
  repository query in an isolated Node child process, which avoids event-loop
  deadlock but has process-start overhead; a native asynchronous repository
  is still the long-term production design.

## 2026-08-18 — remaining Minor findings closed

Status: **complete**. Implementation commit: `ca7c4b7`.

### Changes

- Metrics `app_info` now reads and label-escapes the application version passed
  from `ServerConfig`; no release number remains hard-coded in the route.
- Added a dated `3.1.0` changelog section matching the tagged release contents:
  operations UI, rate limiting, Prometheus metrics, and database guidance.
- Strengthened the Postgres workflow smoke to create a plan and assert the
  complete `GET /plans` / `listProfiles()` response shape, including mapped
  integer and boolean aggregate fields.
- Added a focused test using a real Drizzle Postgres select builder to lock down
  `_prepare` field metadata and `drizzle-orm/utils` row mapping. The private-API
  dependency and mandatory upgrade checks are documented.
- Enforced explicit synchronous-query ceilings of 10,000 returned rows and
  8 MiB serialized output. The child validates before writing, `spawnSync`
  keeps only 64 KiB protocol/error headroom, and overflow errors are explicit.
  Deployment documentation now requires pagination above either ceiling.
- Invalid or unreadable embedded registry indexes now log their underlying
  error and return an explicit HTTP 500 response instead of silently presenting
  an empty catalog.

### Test-first evidence

- Before implementation, the focused suite had four expected failures:
  configured metrics still emitted `3.1.0`, malformed registry YAML returned
  HTTP 200 with an empty catalog, and oversized row/byte results did not throw.
- After implementation, all 11 focused metrics, registry, bridge-mapping, and
  limit tests passed. The real-Drizzle mapping test exercises the exact private
  internals on `drizzle-orm@0.45.2`.

### Final verification

- `npm run quality`: passed lint, all workspace typechecks, 1,263 workspace
  tests (13 contracts + 127 domain + 354 web + 769 server; two server tests
  skipped), four workflow-smoke guard tests, all production builds, and the
  real Chrome skip-link test.
- Fresh live Postgres smoke: health reported a connected Postgres driver;
  `POST /plans` created id `1`; `GET /plans` returned exactly one profile with
  correctly mapped `id`, `name`, `part_count`, `remaining_units`,
  `total_units`, and `build_stale` types.
- Manifest suite: 9 tests passed, followed by successful v1/v2 schema and
  embedded-copy drift validation.
- Actionlint completed with ShellCheck enabled; direct ShellCheck of
  `workflow-smoke.sh` also passed.
- `npm audit --audit-level=high`: passed with zero high/critical findings.

### Remaining concerns

- Four moderate findings remain in `drizzle-kit`'s development-only deprecated
  esbuild loader chain; npm's only automated fix is still a breaking downgrade
  to `drizzle-kit@0.18.1`.
- Postgres remains experimental. The private Drizzle bridge is regression
  tested and bounded, but each query still starts a child process and native
  asynchronous repository transactions remain the production direction.
