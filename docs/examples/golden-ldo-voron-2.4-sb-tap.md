# Golden example: Voron 2.4 / LDO 2.4 + Stealthburner + Tap

Step-by-step setup using **Kit Studio → Build** (no YAML editing). Maintainer manifests still live per repo; this walkthrough is for end users.

## Two presets

Print Partner supports two reference stacks (both use Stealthburner + Tap as addons):

1. **Stock Voron 2.4** — base `Voron-2` + SB + Tap (`voron_2.4_stock_sb_tap`)
2. **LDO Voron 2.4** — base `LDOVoron2` + SB + Tap (`ldo_2.4_sb_tap`)

LDO is **not** layered on top of stock Voron-2 (avoids fork-duplication churn).

## Prerequisites

1. **Sources** — Import [repos.txt](./repos.txt) or add manually:
   - `Voron-2` and/or `LDOVoron2` (pick one as base)
   - `Voron-Stealthburner`, `Voron-Tap` (addons)
2. **Sync** each GitHub source and set import rules.
3. Author manifests per repo — **Kit Studio → Configure** (recommended) or copy examples from [cross-source Voron manifests](./cross-source-voron/ldo-2.4-golden-stack.md).

## Configure manifests (maintainers)

1. Open **Plan → Kit Studio → Configure**.
2. Pick each **repo tab** (base + addons) and set folder/file rules in the tree inspector.
3. Use **Link folder…** for shared categories (e.g. `toolhead` across Stealthburner repos).
4. **Save manifest** per repo when done.

## Configure the build (Kit Studio → Build)

1. Open **Plan** and create or select a profile.
2. Open **Kit Studio → Build** tab.
3. **Choose base** — pick synced `Voron-2` (stock) or `LDOVoron2` (LDO), or click a **stack preset** card.
4. **Stack kits** — preset applies base + addon layers + default selections (`toolhead: stealthburner`, `probe: voron_tap`).
5. Pick variants in each category; watch part counts and source badges.
6. **Export STLs** or **Copy URL** when the build looks correct.

## Validate (Advanced tab)

1. Switch to **Advanced** on Plan.
2. **Replacement map** — toolhead/probe rows show *Replaces stock …* when catalog defines `replaces_slot`.
3. **Recompute** after upstream STL or import-rule changes.

## Maintainer checklist

| Step | Action |
|------|--------|
| Catalog | `stack_presets` + bases in `docs/kit-catalog.yaml` |
| Sources | Role + addon category tags |
| Manifests | Shared `toolhead` / `probe` ids; replacement globs |
| Maintenance | **Sources → Kit maintenance** |
| Golden plan | Re-open profile after upstream changes |

See [author-manifest-on-stack playbook](../playbooks/author-manifest-on-stack.md) for maintainer steps.
