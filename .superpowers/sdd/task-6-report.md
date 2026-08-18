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
