# Release smoke test

Quick manual checklist after `packaging/build_release.sh` (and optional `make_dmg.sh` on macOS).

## Launch

- [ ] App opens without console errors
- [ ] Single workflow bar: **Libraries → Kit → Checkoff** (no duplicate tab bar)
- [ ] On **Kit**, **Compose | Review** appears on the right of the same strip
- [ ] **Help → Workflow guide**, **Open data folder**, **Open exports folder**

## Libraries

- [ ] Empty state → **Add repository**
- [ ] Sync a test repo; table shows **Last sync**, **Commit**, **Updates** (Checking… then Up to date / Updates available)
- [ ] **Import files…** opens dialog (no crash); OK saves rules
- [ ] Browse tree and docs panel update when selecting a repo

## Kit — Compose

- [ ] Empty state → **New build…** wizard; profile loads
- [ ] **Recompute** fills parts tree (or empty banner + Recompute prompt after import)
- [ ] **Next: Review kit →** switches sub-mode
- [ ] Inspector tabs: Preview, Docs, Assistant
- [ ] Suggestions panel (offline); AI **Review suggestions…** if API configured

## Kit — Review

- [ ] Only included parts; uncheck **Print** excludes
- [ ] **← Back to Compose** and **Go to Checkoff →**

## Checkoff

- [ ] Checklist, print progress, **Export checklist**, **Open HTML**

## Quit

- [ ] Clean exit (workers stopped)

Record version, OS, and failures in the release ticket.
