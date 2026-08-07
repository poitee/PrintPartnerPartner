# 3MF export validation (Prusa / Bambu / Orca)

Print Partner writes **3MF Core + Materials** packages via an in-process **fflate** XML writer (not lib3mf). Exports are meant for slicer **import**, not as full slicer project files.

## What to expect

| Concern | Behavior |
|---------|----------|
| **Object names** | Each `<object type="model">` has `name` (and `partnumber`) set to the STL basename, e.g. `bracket.stl`. Quantity copies use `bracket.stl (2)`. PrusaSlicer / Orca read **object `@name`** for the plate object list — not the ZIP filename and not build-item `partnumber` alone. |
| **Materials / colors** | Filament colors are **display hints** via Base Materials (`displaycolor`). Map AMS / MMU slots in the slicer after import. |
| **Layout** | Default **one 3MF per plate** (or a zip of those plates). Import each plate file into a printer profile that matches that machine’s bed. |
| **Not included** | Print settings, G-code, Prusa/Bambu project XML, multi-plate slicer project metadata. |

## Manual checklist

1. **Settings → Printer fleet** — add at least one machine (preset); optionally set loaded filament color ids.
2. On **Review**, choose **Export 3MF → One file per plate** (or Zip all plates).
3. Open the same kit once as **Export STLs** and once as 3MF in:
   - **PrusaSlicer** 2.7+
   - **Bambu Studio** 1.8+
   - **Orca Slicer** (current stable)
4. Confirm:
   - All meshes visible, no crash
   - Object list shows STL filenames (compare with STL import)
   - Colors are recognizable as hints (not necessarily mapped to AMS slots)
5. Prefer importing **one plate 3MF at a time** into the matching physical printer profile.

## Automated coverage

Domain tests in `web/packages/domain/src/export-3mf.test.ts` assert ZIP structure and that model XML contains `name="bracket.stl"`.
