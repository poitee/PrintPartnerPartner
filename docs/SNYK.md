# Snyk (Open Source dependency scanning)

Print Partner runs **Snyk Open Source** against the npm workspaces lockfile (`web/package-lock.json`) in **Web CI**. Container image scanning is not part of this setup.

## What Chad must configure

### 1. Snyk account / token

1. Sign in at [snyk.io](https://snyk.io) (or your org’s Snyk tenant).
2. Create or open the Print Partner organization/project.
3. Optionally **import the GitHub repo** in Snyk (Integrations → GitHub) so the UI shows the same project CI will monitor.
4. Copy an **API token**: Snyk → Account Settings → General → **Auth Token** (service accounts/org tokens are fine if your plan provides them).

### 2. GitHub Actions secret

Repository → **Settings → Secrets and variables → Actions** → **New repository secret**:

| Name | Type | Required? | Purpose |
|------|------|-----------|---------|
| `SNYK_TOKEN` | **Secret** | Yes for scans | Snyk API token. Never commit it. |

No Snyk org/project IDs are required in GitHub for the CLI `test` / `monitor` flow used here.

## When scans run

| Event | Behavior |
|-------|----------|
| `pull_request` / `push` touching `web/**` or this workflow | Snyk job runs |
| `SNYK_TOKEN` set (trusted repo contexts) | `snyk test` on `web/package-lock.json` |
| Fork PR or missing `SNYK_TOKEN` | Job **skips** the scan and **succeeds** (clear log: token unavailable). Secrets are not exposed to forks. |
| Finding at **high** or **critical** | CI **fails** (`--severity-threshold=high`) |
| Low / medium only | CI passes (still visible in SARIF / Snyk UI when uploaded) |

Uses `pull_request` (not `pull_request_target`) so untrusted fork code never runs with privileged secrets.

## Severity threshold

`--severity-threshold=high` — the job fails on **high** and **critical** issues only.

## SARIF / Code Scanning

When a scan runs, results are written to `snyk.sarif` and uploaded with `github/codeql-action/upload-sarif` (`security-events: write`). Upload uses `continue-on-error: true` so missing Code Scanning enablement or permission quirks do **not** break CI; the job still fails on high/critical via an explicit follow-up step.

## Monitoring snapshots (`snyk monitor`)

`snyk monitor` runs only on **push** to `main` or `master` when `SNYK_TOKEN` is present. It records a dependency snapshot in Snyk for ongoing tracking. It does **not** run on pull requests or tags, and monitor failures are non-blocking (`continue-on-error`).

## Scope notes

- One scan of the **web** npm lockfile (workspaces share that lockfile). `docs/scripts` is not scanned.
- Third-party actions used for Snyk/SARIF are pinned to immutable commit SHAs.
- Release/GHCR **container** scanning is intentionally out of scope; see Sentry release docs in [`docs/SENTRY.md`](SENTRY.md) for tagged image publishing.
