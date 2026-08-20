# Golden example: Voron 2.4 / LDO 2.4 + Stealthburner + Tap

Step-by-step setup using **Build** (no YAML editing required for end users). Maintainer manifests still live per repo.

## Two presets

Print Partner supports two reference stacks (both use Stealthburner + Tap as addons):

1. **Stock Voron 2.4** — base `Voron-2` + SB + Tap (`voron_2.4_stock_sb_tap`)
2. **LDO Voron 2.4** — base `LDOVoron2` + SB + Tap (`ldo_2.4_sb_tap`)

LDO is **not** layered on top of stock Voron-2 (avoids fork-duplication churn).

## Prerequisites

1. **Sources** — Add the required repositories:
   - `Voron-2` and/or `LDOVoron2` (pick one as base)
   - `Voron-Stealthburner`, `Voron-Tap` (addons)
2. **Sync** each GitHub source and set import rules.
3. Author manifests per repo — see [author-manifest-on-stack playbook](../playbooks/author-manifest-on-stack.md) or copy examples from [cross-source Voron manifests](./cross-source-voron/ldo-2.4-golden-stack.md).

## Create a build

1. **Create build** in the header (or **Manage builds** on Build).
2. Name the plan (e.g. `Golden LDO 2.4 SB Tap`).

## Configure on Build

1. Open **Build** for your plan.
2. Attach sources — set **base** to synced `Voron-2` (stock) or `LDOVoron2` (LDO), add **Voron-Stealthburner** and **Voron-Tap** as add-ons. Or click a **stack preset** card on the base source’s kit manifest options.
3. Pick variants in each category when preset cards appear; watch part counts in the manifest UI.
4. Expand source cards and check STL folders/files to include.
5. Set **role filament colors** (primary/accent/etc.).
6. Click **Update build**.

## Review and export

1. Open **Review** — confirm validation summary and 3D previews.
2. **Export STLs** (by color or color + directory) or use **Share build** on Build for a plan bundle.
3. Track printing on **Checkoff**.

## Maintainer checklist

| Step | Action |
|------|--------|
| Catalog | `stack_presets` + bases in `docs/kit-catalog.yaml` |
| Sources | Role + addon category tags |
| Manifests | Shared `toolhead` / `probe` ids; replacement globs |
| Maintenance | Re-sync sources after upstream changes |
| Golden plan | Re-run **Update build** after upstream changes |

See [author-manifest-on-stack playbook](../playbooks/author-manifest-on-stack.md) for maintainer steps.
