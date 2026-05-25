# Release smoke test

Quick manual checklist after `packaging/build_release.sh` (and optional `make_dmg.sh` on macOS), or after downloading **Build all platforms** / **Release** artifacts from GitHub Actions.

## CI artifacts

1. Open the green workflow run → **Artifacts** → download `linux`, `macos`, and/or `windows`.
2. Extract and run the app binary inside (same checks as below).
3. For releases, confirm the GitHub Release lists all three platform archives and the CHANGELOG body.

## Launch

- [ ] App opens without console errors
- [ ] Workflow bar: **Libraries → Kit → Print → Checkoff**; **Buy me a Coffee** / Ko-fi opens browser (optional)
- [ ] On **Kit**, **Compose | Review** sub-row when a kit is open
- [ ] **Help → Workflow guide**, **License overview…**, **PolyForm license (full text)…**, **Commercial licensing…**, **Third-party notices…**, **Support on Ko-fi…**, **Open data folder**, **Open exports folder**

## Libraries

- [ ] Guide card explains add → sync → import flow
- [ ] Empty state → **Add repository** / **Add local folder…**
- [ ] Sync a test repo; table columns readable (name, URL, branch, …)
- [ ] **More ▾ → Export repo list…** then **Import repo list…** round-trip
- [ ] **Import files…** opens dialog (no crash); OK saves rules
- [ ] Browse tree and docs panel update when selecting a repo

## Kit — Compose

- [ ] Empty state → **New build…** wizard; profile loads
- [ ] **Recompute** fills parts tree (or empty banner + Recompute prompt)
- [ ] **Filter parts in tree** and search box narrow the tree
- [ ] **Custom filaments…** — add a color; appears in filament picker
- [ ] **Next: Review kit →** switches sub-mode
- [ ] Inspector tabs: Preview, Docs, Assistant (AI optional)

## Kit — Review

- [ ] Only included parts; uncheck **Print** excludes
- [ ] **← Back to Compose** and **Go to Checkoff →**

## Print

- [ ] Empty state when no kit open; opens kit library CTA
- [ ] Enable printer(s); set loaded spool colors
- [ ] Select **repo/folder** row → **Assign folder →**; parts move to printer column
- [ ] **Export 3MF…** produces files; names include filament/repo/folder when grouped

## Checkoff

- [ ] Checklist uses space efficiently; thumbs ~same size as before
- [ ] Print progress saves; **Export checklist** HTML
- [ ] **Help → License overview…**, **PolyForm license…**, and **Commercial licensing…** open bundled markdown; **Third-party notices** opens notices file

## Legal bundle (frozen build)

- [ ] `LICENSE`, `LICENSE-SUMMARY.md`, `THIRD_PARTY_NOTICES.md`, `COMMERCIAL.md` beside executable in onedir / `.app` bundle

## Quit

- [ ] Clean exit (workers stopped)

Record version, OS, and failures in the release ticket.
