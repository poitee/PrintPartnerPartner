# Author manifest on a stack playbook

Maintainer guide: author base and addon manifests that merge on **Build** via shared **choice** ids and **canonical path globs**.

## Mental model

- **One base repo per plan** — stock `Voron-2` OR `LDOVoron2`, not both.
- **Addon repos** merge into shared categories (`toolhead`, `probe`, …).
- **Same choice id** in each repo → merged variants on Build.
- **Rules use relative path globs** (`Stealthburner/**`, `**/Tap/**`) — never absolute disk paths — so community manifests work for everyone who syncs compatible repo layouts.

## Authoring manifests

Maintainers edit `print-partner.manifest.yaml` in each synced repo (or use manifest tooling in the repo). Key concepts:

1. **Folder rules** — Not in kit / Optional / Required; category mode (choose one / any / N); category id; cross-repo **Link folder** for shared categories.
2. **File rules** — Requirement override, default included; on addon repos: Added vs Replacement + target glob or slot.
3. **Path globs** — Use `Folder/**` patterns aligned with [path-hints.yaml](../path-hints.yaml) (Stealthburner, Tap, PrintedParts, …).

### Cross-repo linking

Tie the same category id across repos. Each member stores that repo’s **relative path glob** (e.g. `Stealthburner/**` vs `Galileo2/**`).

## Workflow map

| Step | Where |
|------|--------|
| Directory rules, categories | Per-repo `print-partner.manifest.yaml` (maintainer) |
| Stack presets, variant picks | **Build** → kit manifest options on base source |
| STL file inclusion | **Build** → per-source file pickers |
| Role filament colors | **Build** → Colors by role |
| Quantities, validation | **Review** |
| Printed units, checklist | **Checkoff** |

Use the sidebar **Build → Review → Checkoff** pipeline for the active plan.

## Golden reference manifests

See [cross-source Voron manifests](../examples/cross-source-voron/ldo-2.4-golden-stack.md):

- `voron-2-base.manifest.yaml` — stock Voron 2.4 base
- `ldo-voron2-base.manifest.yaml` — LDO base (no Voron-2 overlay)
- `stealthburner-addon.manifest.yaml` — toolhead addon
- `voron-tap-addon.manifest.yaml` — probe addon

## Validation checklist

- [ ] Shared choice ids match across base + addons
- [ ] Path globs align with [path-hints.yaml](../path-hints.yaml) where possible
- [ ] Folder rules use `Folder/**` globs, not per-file explosion
- [ ] Addon variants declare `excludes` for stock globs
- [ ] Replacement parts use `replaces` or slot mapping
- [ ] Review shows no blocking issues on golden profile
- [ ] Sources synced — no drift warnings

## Publish

Community manifest bundles can be exported for maintainers. Multi-source plans may split one manifest per repo URL. See manifest registry entries in **Help** inside the app.
