# Kit Studio Build playbook

End-user guide: choose a base repo, apply a stack preset, pick variants in **Build**.

## 1. Sync sources

On **Sources**, import [repos.txt](../examples/repos.txt) or add repos manually. Sync each GitHub source and verify STLs appear in the import tree.

## 2. Create a plan profile

**Plan →** create or select a profile (e.g. "My Voron 2.4 SB Tap").

## 3. Configure manifests (maintainers)

Open **Kit Studio → Configure** to set folder/file rules per repo tab. Rules persist as path globs in each repo’s `print-partner.manifest.yaml`. See [author-manifest-on-stack.md](./author-manifest-on-stack.md).

## 4. Open Kit Studio → Build

The **Build** tab opens by default when the profile has a base layer and manifest data.

### Choose a base

- If no base is set: pick a catalog base button or apply a **stack preset** (sets base + addons in one step).
- With a base set: use **Change base** to switch (may require re-applying presets).

### Stack presets

Reference presets from `docs/kit-catalog.yaml`:

| Preset | Base | Addons |
|--------|------|--------|
| Voron 2.4 (stock) + Stealthburner + Tap | Voron-2 | SB, Tap |
| LDO 2.4 + Stealthburner + Tap | LDOVoron2 | SB, Tap |

Click a preset card to apply layers and default variant selections.

### Pick variants

Each **choice** row shows:

- Rule badge (choose one / add any)
- Active addon source name
- Part count
- *Replaces stock …* hint when the catalog defines `replaces_slot`

Pick variant cards; the plan recomputes automatically.

After Build, set **filament colors and quantities** on **Plan → Parts** and track printing on **Checkoff** (shortcuts in Kit Studio header).

## 5. Export or share

- **Export STLs** — included parts only
- **Copy URL** — shareable plan link with kit overlay hash
- **Publish** — community manifest bundle (maintainers)
- **Plate** / **Checkoff** — header links for layout and shop-floor checklist

## Troubleshooting

| Issue | Fix |
|-------|-----|
| Preset grayed / error | Sync missing repos on Sources |
| Empty build choices | Recompute + Apply manifest; check Configure rules |
| Wrong variants | Check per-repo manifests; shared choice ids must match |
| Tree badges wrong | Save manifests; path globs must match repo layout |

See [golden LDO 2.4 example](../examples/golden-ldo-voron-2.4-sb-tap.md).
