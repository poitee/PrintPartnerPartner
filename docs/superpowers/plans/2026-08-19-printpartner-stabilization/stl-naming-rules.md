# STL naming rules

## Role in the workflow

STL naming rules belong between file selection and the required-parts list.
They turn each selected STL path into an inferred filament role, an inferred
quantity, and a part slug. The inferred quantity creates the physical units
used by Checkoff, exports, and plate planning.

The UI should make successful inference visible without adding another stage.
A selected file can show `Accent` and `x4` badges. Plan should open exception
review only when a filename looks suspicious or a source needs different
rules.

## Current default rules

The default role markers are `[a]` for accent, `[c]` for clear, and `[o]` for
opaque. A file without a matching marker becomes primary. Markers match any
path segment and ignore case.

The default quantity expression accepts `_xN.stl` and a space followed by
`xN.stl` at the end of a filename. The STL extension match ignores case, so
`corner x2.STL` infers quantity two. A filename without a match receives
quantity one.

| Selected STL path | Filament role | Inferred quantity |
|---|---|---:|
| `[a]_feet_x4.stl` | Accent | 4 |
| `[c]/lens.stl` | Clear | 1 |
| `shell/[o]_cover.stl` | Opaque | 1 |
| `corner x2.STL` | Primary | 2 |
| `corner-x2.stl` | Primary | 1 |

Folder rules take priority over markers. A source can use the global rules or
define source-specific rules. A manual quantity overrides the inferred
quantity while the selected file keeps the same relative path.

[Default naming profile](../../../../web/packages/domain/src/stl-naming.ts)
[Path parser](../../../../web/packages/domain/src/parsers.ts)
[Plan recompute](../../../../web/apps/server/src/db/repository.ts)

## Downstream use

The effective quantity controls the number of Checkoff units, STL copies, and
3MF objects. The filament role groups parts for filament assignment, previews,
filters, and export.

The role is a planning category. It does not prove which filament or spool the
operator will use.

## Repair before UI migration

- Add the missing server handler for `PUT /sources/:id/naming` and test both
  reading and saving source rules.
- Mark dependent Builds stale when global or source-specific rules change.
- Use each source's effective rules for preview, filtering, and export.
- Show whether a quantity is inferred or manual. Add an action that restores
  the inferred quantity.
- Reject blank folder rules and quantity expressions that do not return a
  finite integer of at least one. Apply the same rule in scanning, preview,
  recompute, and export; reject zero, negative, fractional, `NaN`, and
  `Infinity` results in each path.
- Make the scanner and warning detector agree about accepted quantity forms.
- Cover upper- and lowercase STL extensions in the quantity-inference tests.
- Cover every invalid quantity class at the shared validation boundary and one
  downstream path.

The repository quality gate now runs the existing naming-rule tests. The
uppercase-extension case remains an explicit regression case for this repair.
