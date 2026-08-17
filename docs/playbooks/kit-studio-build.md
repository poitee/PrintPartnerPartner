# Build playbook — stack presets and variants

End-user guide: sync sources, create a build, apply a stack preset, and pick variants on **Build**.

## 1. Sync sources

On **Sources**, import [repos.txt](../examples/repos.txt) or add repos manually. Sync each GitHub source and verify STLs appear when you expand the import tree on Build.

## 2. Create a build

Create or select a plan:

- Header **Create plan** button or plan picker
- **Plans** page in the spine utility nav (legacy `/builds` redirects)
- **Builds** page in the sidebar

Name it something recognizable (e.g. "My Voron 2.4 SB Tap").

## 3. Configure manifests (maintainers)

Author per-repo manifests so stack presets and variant picks work. See [author-manifest-on-stack.md](./author-manifest-on-stack.md). Rules persist as path globs in each repo’s `print-partner.manifest.yaml`.

## 4. Build page

Open **Build** for your active plan.

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

Set a color per role (primary, accent, clear, opaque) in **Colors by role**. Previews on Build, Review, and Checkoff update when you change a color.

### Update build

Click **Update build** when the stale banner appears (or enable **auto-recompute stale builds** in Settings). This refreshes Review and Checkoff from your file picks.

## 5. Review, Checkoff, export

- **Review** — validation summary, quantity edits, **Export STLs** (by color or color + directory).
- **Checkoff** — per-unit progress, printable checklist, **Export missing STLs**.
- **Share build** on Build — export a `.print-partner-kit` zip (plan config, not STLs).

## Troubleshooting

| Issue | Fix |
|-------|-----|
| Preset grayed / error | Sync missing repos on Sources |
| Empty variant choices | Run **Update build**; check manifest rules in repo YAML |
| Wrong variants | Check per-repo manifests; shared choice ids must match |
| Stale Review parts | Click **Update build** on Build |
| Colors not in previews | Change role color again or use Advanced → Regenerate thumbnails |

See [golden LDO 2.4 example](../examples/golden-ldo-voron-2.4-sb-tap.md).
