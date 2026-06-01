# Cross-source Voron example manifests

Minimal `print-partner.manifest.yaml` snippets for a Voron base + Stealthburner + umbilical stack. Copy into each synced repo root, or define import rules on **Sources** and build picks on **Build**.

For the **LDO Voron 2.4 golden build** (SB + Tap), see [ldo-2.4-golden-stack.md](./ldo-2.4-golden-stack.md) for which repos need manifests.

| File | Role | Notes |
|------|------|-------|
| [voron-base.manifest.yaml](./voron-base.manifest.yaml) | base | Required frame + stock toolhead slot |
| [stealthburner-addon.manifest.yaml](./stealthburner-addon.manifest.yaml) | addon | `toolhead` setup, hull replacement, excludes stock paths |
| [umbilical-addon.manifest.yaml](./umbilical-addon.manifest.yaml) | addon | `cable_routing` slot + second `toolhead` variant |

After saving manifests to repo roots: sync on **Sources** → attach layers on **Build** → **Update build** → **Review** → **Plate**.

For optional manifest apply after merge, see [WORKFLOW_2_0.md](../../WORKFLOW_2_0.md#advanced--manifest-optional).
