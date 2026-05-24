# 3MF export validation

Print Partner exports kits as **3MF Core + Materials** (geometry and filament color hints). Slicer project settings are not embedded.

## Automated (CI)

`tests/test_export_3mf.py` checks:

- Object count matches included parts × quantity
- `object@name` values (`bracket.stl`, `bracket.stl (2)`, …) via lib3mf read-back
- At least one `BaseMaterialGroup` when filament colors are set

## Print tab setup

1. **Print** workflow step → add printers (or **Help → Manage printers**).
2. Check **Use** for each machine printing this kit.
3. Set **loaded filament** on each printer to match part colors on the kit.
4. Review **Assignment preview** and plate estimate → **Export 3MF**.

## Manual matrix (before shipping a release)

Use a small kit (2–3 STLs, 2 filament colors on two printers).

| Step | PrusaSlicer 2.7+ | Bambu Studio | Orca Slicer |
|------|------------------|--------------|-------------|
| File → Import | Pass / fail | Pass / fail | Pass / fail |
| All parts visible on plate | | | |
| Object list shows **STL filenames** (not `KitName_1`) | | | |
| Filament/material colors recognizable | | | |
| No crash on open | | | |

Compare with **Export STLs** import: object names should match.

Record slicer version and pass/fail in the release ticket.

## User expectations

- Colors are **hints** only; assign AMS/MMU slots in the slicer.
- Parts are laid out on the bed in a simple grid; rearrange as needed.
