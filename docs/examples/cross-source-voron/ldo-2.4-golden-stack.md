# LDO Voron 2.4 golden stack — manifests by repo

Two **stack presets** are supported (see `docs/kit-catalog.yaml` → `stack_presets`):

| Preset | Base repo | Addons |
|--------|-----------|--------|
| **Voron 2.4 (stock) + SB + Tap** | `Voron-2` | `Voron-Stealthburner`, `Voron-Tap` |
| **LDO 2.4 + SB + Tap** | `LDOVoron2` | `Voron-Stealthburner`, `Voron-Tap` |

Do **not** overlay LDO on Voron-2 — LDO repos are near-forks; pick `LDOVoron2` as base for LDO builds.

## Manifests by repo

| Source | Role | Manifest |
|--------|------|----------|
| `Voron-2` | Base (stock preset) | [voron-2-base.manifest.yaml](./voron-2-base.manifest.yaml) |
| `LDOVoron2` | Base (LDO preset) | [ldo-voron2-base.manifest.yaml](./ldo-voron2-base.manifest.yaml) |
| `Voron-Stealthburner` | Toolhead addon (both) | [stealthburner-addon.manifest.yaml](./stealthburner-addon.manifest.yaml) |
| `Voron-Tap` | Probe addon (both) | [voron-tap-addon.manifest.yaml](./voron-tap-addon.manifest.yaml) |
| `LDO-Extras` | Z drives (optional) | Local folder source — not in GitHub import |
| `Voron-Extras` | Skirts (optional) | [template-addon-pick_any.manifest.yaml](../template-addon-pick_any.manifest.yaml) |

Shared category ids (`toolhead`, `probe`) let SB/Tap addons merge into either base.

**Kit Studio Build:** apply a stack preset card, then pick variants. See [kit-studio-build playbook](../../playbooks/kit-studio-build.md).

See [README](./README.md) for cross-source replacement and umbilical examples.
