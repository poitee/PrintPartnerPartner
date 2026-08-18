# 3MF export validation (Prusa / Bambu / Orca)

Print Partner writes **3MF Core + Materials** packages via an in-process **fflate** XML writer (not lib3mf). Exports are meant for slicer **import**, not as full slicer project files.

## What to expect

| Concern | Behavior |
|---------|----------|
| **Object names** | Each `<object type="model">` has `name` (and `partnumber`) set to the STL basename, e.g. `bracket.stl`. Quantity copies use `bracket.stl (2)`. PrusaSlicer / Orca read **object `@name`** for the plate object list — not the ZIP filename and not build-item `partnumber` alone. |
| **Materials / colors** | Filament colors are **display hints** via Base Materials (`displaycolor`). Map AMS / MMU slots in the slicer after import. |
| **Printer routing** | Parts go to an enabled fleet machine whose loaded slot `filament_color_id` matches the part. Matching is **id-exact** (no hex-fuzzy “close enough” in v1). Unmatched parts warn and fall back to the first enabled printer. |
| **Layout** | Default **one 3MF per plate per printer** (or a zip of those plates + `print_plan.json`). Import each plate file into a slicer profile that matches that physical printer’s bed. |
| **Not included** | Print settings, G-code, Prusa/Bambu project XML, multi-plate slicer project metadata. |

## Setup

1. **Settings → Printer fleet** — add machines (presets or custom bed). Set **loaded filament** on each slot from the catalog so kit colors can route to the right printer.
2. On **Export**, use **Printers for this plan** to enable a subset of the fleet for the active kit (empty selection = whole fleet).
3. Choose **Export 3MF** layout:
   - **One file per plate** (default) — best for Prusa / Bambu / Orca
   - **Zip all plates** — plate 3MFs plus `print_plan.json`
   - **Single file — plates spaced apart** — one 3MF; plates offset in X
   - **Single plate only** — fails if any enabled printer needs more than one bed

## Manual checklist

1. Load filaments on the fleet so they match the kit’s `filament_color_id` values.
2. On **Export**, confirm assignment / plate estimate, then **Export 3MF → One file per plate**.
3. Open the same kit once as **Export STLs** and once as 3MF in:
   - **PrusaSlicer** 2.7+
   - **Bambu Studio** 1.8+
   - **Orca Slicer** (current stable)
4. Confirm:
   - All meshes visible, no crash
   - Object list shows STL filenames (compare with STL import)
   - Colors are recognizable as hints (not necessarily mapped to AMS slots)
5. Prefer importing **one plate 3MF at a time** into the matching physical printer profile. Filament colors are hints — verify AMS slot mapping in the slicer.

## Automated coverage

- `web/packages/domain/src/filament-assigner.test.ts` — two printers / two filaments split; missing filament warning; enabled-id resolution.
- `web/packages/domain/src/plate-packer.test.ts` — one-bed fit, overflow → two plates, oversized part and Z-limit warnings.
- `web/packages/domain/src/export-3mf.test.ts` — ZIP structure, `name="bracket.stl"`, multi-printer files, `print_plan.json` manifest, zip mode, single-plate-only rejection.
