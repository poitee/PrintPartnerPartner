# Golden QA export — LDO 2.4 + Stealthburner + Tap

Export a **kit bundle** (`.print-partner-kit.zip`) after applying the `ldo_2.4_sb_tap` stack preset for regression and release smoke tests.

## Prerequisites

1. Sync on **Sources**: `LDOVoron2`, `Voron-Stealthburner`, `Voron-Tap` (see [repos.txt](./repos.txt)).
2. Set import rules on each repo (printed parts folders only).
3. Author per-repo manifests — [cross-source Voron stack](./cross-source-voron/ldo-2.4-golden-stack.md).

## Build the golden plan

1. **Plan** → create or open a profile (e.g. `Golden LDO 2.4 SB Tap`).
2. **Kit Studio → Build** → apply stack preset **LDO 2.4 + Stealthburner + Tap** (`ldo_2.4_sb_tap`).
3. Confirm layers: base `LDOVoron2`, addons `Voron-Stealthburner`, `Voron-Tap`.
4. Confirm selections: `toolhead: stealthburner`, `probe: voron_tap`.
5. **Recompute** (Plan toolbar) and resolve manifest warnings in **Advanced**.

## Export QA bundle

1. **Plan → Advanced** (or legacy kit export) → **Export kit bundle**.
2. Or start job: `POST /jobs/export-kit-bundle` with `{ "profile_id": <id> }`.
3. Save as `golden-ldo-2.4-sb-tap.print-partner-kit.zip` for CI or manual diff.

## Verify bundle contents

Unzip and check:

| Artifact | Expect |
|----------|--------|
| `manifest.json` / kit overlay | Selections match preset |
| STL paths | No stock toolhead/probe when SB + Tap selected |
| Layer refs | Base + two addon source names |

## Related docs

- End-user walkthrough: [golden-ldo-voron-2.4-sb-tap.md](./golden-ldo-voron-2.4-sb-tap.md)
- Community manifest: `manifests/community/ldo-2.4-sb-tap/manifest.yaml`
- Catalog preset: `docs/kit-catalog.yaml` → `stack_presets.ldo_2.4_sb_tap`
