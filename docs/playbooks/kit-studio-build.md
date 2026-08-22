# Plan playbook — stack presets and variants

End-user guide: sync sources, create a Build, apply a stack preset, and pick variants on **Sources**.

## 1. Sync sources

On **Library**, add the source repositories. Sync each GitHub source and verify STLs appear when you expand the import tree on Sources.

## 2. Create a Build

Create or select a Build:

- Header **New Build** button (asks only for a name, then opens Sources)
- **Builds** page in the spine utility nav

Name it something recognizable (e.g. "My Voron 2.4 SB Tap").

## 3. Configure manifests (maintainers)

Author per-repo manifests so stack presets and variant picks work. See [author-manifest-on-stack.md](./author-manifest-on-stack.md). Rules persist as path globs in each repo’s `print-partner.manifest.yaml`.

## 4. Sources page

Open **Sources** for your active Build.

### Attach sources

- Use **Attach sources** (or set base/add-on layers) if no source is linked yet.
- Base layer holds the main kit repo; add-on layers hold toolhead, probe, and other overlays.

### Stack presets and kit manifest options

On the **base** source card, **Kit manifest options** shows stack preset cards when the kit catalog is configured. Reference presets from `docs/kit-catalog.yaml`:

| Preset | Base | Addons |
|--------|------|--------|
| Voron 2.4 (stock) + Stealthburner + Tap | Voron-2 | SB, Tap |
| LDO 2.4 + Stealthburner + Tap | LDOVoron2 | SB, Tap |

Click a preset to apply layers and default variant selections.

### Pick STL files

Expand each source card, check files or folders to include, and use the **STL preview** pane to verify geometry. Selections save automatically.

### Role filament colors

Set a color per role (primary, accent, clear, opaque) in **Colors by role**. Previews on Sources, Plan, and Checkoff update when you change a color.

### Review and apply the plan

Click **Rebuild draft** after changing sources. File and quantity changes remain proposed while you review the draft on **Plan**. Click **Apply** to update the accepted Plan and Required units.

## 5. Plan, Checkoff, Production

- **Plan** — quantities, warnings, apply the draft.
- **Checkoff** — per-unit progress, printable checklist.
- **Production** — plate workspace, STL/3MF packs, slicer links, printer bind/send.
- **Share** on Sources — export a `.print-partner-kit` zip (plan config, not STLs).

## Troubleshooting

| Issue | Fix |
|-------|-----|
| Preset grayed / error | Sync missing repos on Library |
| Empty variant choices | Rebuild the draft; check manifest rules in repo YAML |
| Wrong variants | Check per-repo manifests; shared choice ids must match |
| Stale Plan list | Review and apply the saved draft on Plan |
| Colors not in previews | Change role color again or use Advanced → Regenerate thumbnails |

See [golden LDO 2.4 example](../examples/golden-ldo-voron-2.4-sb-tap.md).
