# Author manifest on a stack playbook

Maintainer guide: author base and addon manifests that merge on Plan via shared **choice** ids and **canonical path globs**.

## Mental model

- **One base repo per plan** — stock `Voron-2` OR `LDOVoron2`, not both.
- **Addon repos** merge into shared categories (`toolhead`, `probe`, …).
- **Same choice id** in each repo → merged variants on Plan Build.
- **Rules use relative path globs** (`Stealthburner/**`, `**/Tap/**`) — never absolute disk paths — so community manifests work for everyone who syncs compatible repo layouts.

## Configure flow (Kit Studio → Configure)

1. Select a **repo tab** (base or addon on the plan stack). Tabs are always visible in Configure mode.
2. **Click a folder or file** in the repo tree — the center **Tree inspector** shows rules for that path.
3. **Folder rules** — Not in kit / Optional / Required; category mode (choose one / any / N); category id; **Link folder…** for cross-repo linking.
4. **File rules** — Requirement override, default included; on addon repos: Added vs Replacement + target glob or slot.
5. **Bulk edit** — Shift-click files in the tree; use the bulk bar for requirement / default included.
6. **Save manifest** — writes `print-partner.manifest.yaml` to the synced repo (canonical globs only).

### Path hints

Tree rows show suggested categories from [path-hints.yaml](../path-hints.yaml) (Stealthburner, Tap, PrintedParts, …). The **Advanced** accordion includes path-hints bulk apply and rename controls.

### Cross-repo linking

Use **Link folder…** to tie the same category id across repos. Each member stores that repo’s **relative path glob** (e.g. `Stealthburner/**` vs `Galileo2/**`). Optional `category_links` on the plan kit overlay caches link metadata for UI badges only — repo YAML remains authoritative.

### Context header

Shows `Configure: {repo} · base|addon · stacks on {reference base}`.

## Build vs Plan / Plate / Checkoff

| Step | Where |
|------|--------|
| Directory rules, categories | **Configure** (Kit Studio) |
| Variant picks | **Build** (Kit Studio) |
| Filament colors + quantities | **Plan → Parts** |
| Bed layout + 3MF export | **Plate** |
| Printed units + checklist | **Checkoff** |

Kit Studio header links to **Plate** and **Checkoff** for the active profile.

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
- [ ] Plan warnings zero on golden profile
- [ ] Sources → Kit maintenance — no drift

## Publish

**Publish** drawer exports community bundle or opens PR template. Multi-source plans split one manifest per repo URL.
