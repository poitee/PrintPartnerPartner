# Complete Codebase Audit Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Resolve every verified August 18 audit finding and merge a clean,
fully validated branch to `main`.

**Architecture:** Harden the existing Fastify middleware and repository
boundaries rather than adding a second security system. Reuse shared frontend
state helpers for consistent workflows. Strengthen existing GitHub Actions and
small validation scripts instead of introducing a new build platform.

**Tech Stack:** TypeScript 6, Fastify, Drizzle, React 19, TanStack Query,
Vitest, Vite, GitHub Actions, Docker Compose, Python/PyYAML/jsonschema.

## Global Constraints

- Production and non-loopback deployments are secure by default; loopback
  development remains usable without configuration.
- Every behavior change starts with a failing regression test.
- Preserve existing API response compatibility unless the old response exposes
  credentials or cross-tenant data.
- Preserve the existing industrial desk-loop visual language.
- No audit PR may remain open after all quality gates pass.

---

### Task 1: Authentication and administrative route hardening

**Files:**
- Modify: `web/apps/server/src/middleware/api-key.ts`
- Modify: `web/apps/server/src/services/api-key-manager.ts`
- Modify: `web/apps/server/src/routes/auth.ts`
- Modify: `web/apps/server/src/routes/metrics.ts`
- Modify: `web/apps/server/src/routes/webhooks.ts`
- Modify: `web/apps/server/src/app.ts`
- Test: colocated middleware/route/service tests under `web/apps/server/src`

**Interfaces:**
- `registerApiKeyAuth` consumes the repository-backed key validator.
- Settings API keys remain `ppk_…` bearer credentials and are never stored or
  listed in recoverable form.
- Administrative routes use one shared pre-handler.

- [ ] **Step 1: Write failing tests**

Cover: spoofed `Sec-Fetch-Site` cannot bypass `/api/v1`; a settings-created key
authenticates then stops after revoke/expiry; production `dev-login` is absent;
production cookies include `Secure`; `Bearer garbage` cannot read metrics;
webhook lists omit secrets; destructive/admin routes reject unauthenticated
non-loopback requests.

- [ ] **Step 2: Verify the tests fail for the audited behavior**

Run the new test files with:

```bash
cd web
npm run test -w @print-partner/server -- api-key auth metrics webhooks backups
```

- [ ] **Step 3: Implement the shared security policy**

Use Node `crypto` HMAC/timing-safe comparison for settings keys, remove
client-controlled fetch-header bypasses, add production guards, redact secrets,
and apply the shared admin pre-handler to backups, API-key settings, logging,
and other destructive operational routes.

- [ ] **Step 4: Run focused and server-wide tests**

```bash
cd web
npm run typecheck -w @print-partner/server
npm run test -w @print-partner/server
```

- [ ] **Step 5: Commit**

```bash
git add web/apps/server/src
git commit -m "fix: harden API and administrative authentication"
```

### Task 2: Tenant isolation, atomic mutations, and bounded jobs

**Files:**
- Modify: `web/apps/server/src/db/repository.ts`
- Modify: `web/apps/server/src/routes/jobs.ts`
- Modify: `web/apps/server/src/routes/api-v1.ts`
- Modify: `web/apps/server/src/routes/job-websocket.ts` or actual websocket
  registration file discovered from `registerJobWebSocket`
- Test: `web/apps/server/src/phase6.test.ts`
- Test: job/recompute tests colocated with implementation

**Interfaces:**
- Profile-scoped repository operations fail when `getProfile(id)` is not
  visible to the current tenant.
- Job snapshots retain tenant ownership; `get`, `list`, and `subscribe` require
  the current tenant.
- Completed jobs are pruned by a finite retention policy.

- [ ] **Step 1: Write failing cross-tenant and rollback tests**

Create tenant A/B profiles and jobs. Assert tenant B cannot recompute/export,
poll, list, or subscribe to tenant A resources. Inject a recompute failure and
assert SQLite rows roll back. Assert old completed jobs are evicted.

- [ ] **Step 2: Verify red tests**

```bash
cd web
npm run test -w @print-partner/server -- phase6 jobs recompute
```

- [ ] **Step 3: Add tenant guards, transaction boundaries, and retention**

Guard repository entry points, use the native SQLite transaction path for
multi-statement recompute, tenant-filter job APIs/subscriptions, and prune
terminal snapshots without changing active-job behavior.

- [ ] **Step 4: Add a real Postgres smoke workflow or documented experimental gate**

Exercise health plus plan creation against a Postgres service container. If the
sync bridge cannot safely support native ACID writes in this patch, make the
deployment status explicit and keep production SaaS startup fail-closed rather
than claiming full support.

- [ ] **Step 5: Verify and commit**

```bash
cd web
npm run typecheck -w @print-partner/server
npm run test -w @print-partner/server
git add web/apps/server .github docs
git commit -m "fix: enforce tenant isolation and atomic job data"
```

### Task 3: Export and desk-loop workflow consistency

**Files:**
- Modify: `web/apps/web/src/components/export/SlicerHandoffPanel.tsx`
- Modify: `web/apps/web/src/pages/SourcesPage.tsx`
- Modify: `web/apps/web/src/pages/BuildPage.tsx`
- Modify: `web/apps/web/src/pages/PlansPage.tsx`
- Modify: `web/apps/web/src/pages/CheckoffPage.tsx`
- Modify: `web/apps/web/src/pages/SettingsPage.tsx`
- Modify: `web/apps/web/src/context/PlanWorkspaceContext.tsx`
- Modify: `web/apps/web/src/queries/planReview.ts`
- Test: focused component/lib tests under `web/apps/web/src`

**Interfaces:**
- `resolveEnabledPrinterIds` is the only frontend interpretation of saved
  printer IDs.
- Optimistic mutations expose their error to the initiating workflow.
- Each engine-dependent page renders one explicit offline/loading/error/empty
  state before mutation controls.

- [ ] **Step 1: Write failing workflow tests**

Cover handoff printer IDs, Library offline state, Progress mutation feedback,
profile-list failure, and disabled controls while offline.

- [ ] **Step 2: Verify red tests**

```bash
cd web
npm run test -w @print-partner/web -- SlicerHandoff Sources Checkoff Profile
```

- [ ] **Step 3: Implement workflow fixes**

Fetch the saved print plan for handoff, normalize enabled IDs, expose mutation
errors through Sonner, and standardize engine/profile state rendering across
desk-loop pages.

- [ ] **Step 4: Verify and commit**

```bash
cd web
npm run typecheck -w @print-partner/web
npm run test -w @print-partner/web
git add web/apps/web
git commit -m "fix: align export and offline workflows"
```

### Task 4: Accessibility and responsive UI

**Files:**
- Modify: `web/apps/web/src/components/layout/AppLayout.tsx`
- Modify: `web/apps/web/src/components/layout/SpineRail.tsx`
- Modify: `web/apps/web/src/components/layout/PageHeader.tsx`
- Modify: `web/apps/web/src/App.tsx`
- Modify: `web/apps/web/src/pages/LoginPage.tsx`
- Modify: `web/apps/web/src/pages/WelcomePage.tsx`
- Modify: `web/apps/web/src/pages/PlansPage.tsx`
- Modify: `web/apps/web/src/pages/CheckoffPage.tsx`
- Modify: `web/apps/web/src/components/parts/ReviewPartsSheet.tsx`
- Test: focused web tests

**Interfaces:**
- The shell brand is not an `h1`; every routed page title is the page-level
  `h1`.
- `<main id="main-content">` is targeted by the first keyboard-focusable skip
  link.
- Loading text uses `role="status"` and `aria-live="polite"`.

- [ ] **Step 1: Add failing accessibility tests**

Assert one `h1`, skip-link target, named search inputs, form submit on Enter,
live loading semantics, SPA navigation, and accessible mobile plan actions.

- [ ] **Step 2: Verify red tests**

```bash
cd web
npm run test -w @print-partner/web -- accessibility Login Welcome Plans
```

- [ ] **Step 3: Implement restrained accessibility/responsive fixes**

Use semantic HTML and existing tokens/components. Replace the narrow table with
responsive cards or pinned actions at phone widths. Keep the desktop table.

- [ ] **Step 4: Verify and commit**

```bash
cd web
npm run typecheck -w @print-partner/web
npm run test -w @print-partner/web
git add web/apps/web
git commit -m "fix: improve desk-loop accessibility and mobile flows"
```

### Task 5: Core integrity and coverage gaps

**Files:**
- Test/Create: `web/packages/domain/src/kit-print-plan.test.ts`
- Test/Create: `web/packages/domain/src/secure-path.test.ts`
- Test/Create: `web/apps/server/src/services/export-3mf-job.test.ts`
- Test/Create: `web/apps/server/src/services/backup-restore.test.ts`
- Modify: `web/packages/domain/src/plate-packer.ts`
- Modify: `web/apps/server/tsconfig.json`

**Interfaces:**
- Print-plan serialization round-trips supported layouts and rejects malformed
  values predictably.
- Backup validation rejects corrupt/traversal archives before mutation.
- Domain packers return warnings; they do not call `console.warn`.
- Server production output excludes test modules.

- [ ] **Step 1: Add focused tests for each uncovered core**
- [ ] **Step 2: Run each test and confirm the intended failure**
- [ ] **Step 3: Implement minimal integrity fixes and build tsconfig split**
- [ ] **Step 4: Run domain/server tests and inspect `dist` for test output**

```bash
cd web
npm run test -w @print-partner/domain
npm run test -w @print-partner/server
npm run build -w @print-partner/server
test -z "$(find apps/server/dist -name '*.test.js' -print -quit)"
```

- [ ] **Step 5: Commit**

```bash
git add web/packages/domain web/apps/server
git commit -m "test: cover core print and recovery integrity"
```

### Task 6: CI, release, manifests, dependencies, and documentation

**Files:**
- Modify: `.github/workflows/web-ci.yml`
- Modify: `.github/workflows/release.yml`
- Modify: `.github/workflows/validate-manifests.yml`
- Create: `.github/dependabot.yml`
- Create: `.nvmrc`
- Modify: `web/package.json`
- Modify: manifest validation scripts/files under `manifests/`
- Modify: `README.md`, `web/README.md`, `SECURITY.md`, `web/DEPLOY.md`
- Remove or replace: `web/CHANGELOG.md`
- Modify: Docker Compose comments and image tags

**Interfaces:**
- One reusable quality command sequence gates CI and release.
- Manifest validator selects schema from `version` and checks embedded-copy
  drift.
- Node 22 is the repository runtime contract.

- [ ] **Step 1: Add failing manifest fixtures and drift check**
- [ ] **Step 2: Implement v1/v2 JSON Schema validation**
- [ ] **Step 3: Add build/Docker/release/dependency CI gates**
- [ ] **Step 4: Align Node/action/package metadata and move type-only deps**
- [ ] **Step 5: Correct stale documentation and remove dead Copilot UI paths**
- [ ] **Step 6: Validate workflows, manifests, compose, audit, and docs links**

```bash
cd web
npm ci
npm audit --audit-level=high
npm run lint
npm run typecheck
npm test
npm run build
cd ..
python manifests/scripts/validate.py
docker compose config
docker compose -f docker-compose.saas.yml config
```

- [ ] **Step 7: Commit**

```bash
git add .github .nvmrc manifests README.md SECURITY.md web docker-compose*.yml
git commit -m "chore: strengthen CI and repository hygiene"
```

### Task 7: Final verification, review, cleanup, and merge

**Files:**
- Modify only files required by final review findings.

- [ ] **Step 1: Run the complete automated gate**

```bash
cd web
npm run lint
npm run typecheck
npm test
npm run build
```

- [ ] **Step 2: Run manual browser workflows**

Verify setup/offline behavior, printer-scoped handoff, Progress error feedback,
keyboard navigation, headings, and a 375px viewport. Capture one concise demo
video and selected screenshots.

- [ ] **Step 3: Run CodeRabbit on the entire branch**

```bash
coderabbit review --agent --base main
```

- [ ] **Step 4: Fix and re-review all critical/warning findings**
- [ ] **Step 5: Push, create/update the PR, wait for CI, and merge to `main`**
- [ ] **Step 6: Confirm no open PRs and delete merged/stale Cursor branches**
