# Phase 8: reshape the site around the accepted workflow

[Back to the overview](overview.md)

## Goal

Make navigation and page ownership match the Phase 0 site map.

## Changes

- Replace the global navigation with Builds, Production, Printers, and
  Settings.
- Give each Build Sources, Plan, Checkoff, and Production destinations.
- Move the useful Parts interactions into Plan and remove Parts as a separate
  route after its callers migrate.
- Move Printer allocation, Plate editing, downloads, Printer job tracking, and
  verification into Production. Remove Export as a separate route after its
  callers migrate.
- Make global Production an aggregate of active Printer jobs, Plates awaiting
  verification, failures, and recent work across Builds. Do not add a separate
  farm mode.
- Use a calm, spacious layout for Sources, Plan, and Checkoff. Use a denser
  operational layout for Build and global Production.
- Use one token and component system across both densities. Keep the printable
  Checkoff sheet on a dedicated paper layout.
- Make Builds the initial section. Use one responsive list for small and large
  collections rather than separate personal and farm dashboards.
- Show Build name, Plan state, Checkoff completion, active Printer jobs, and
  work awaiting verification in each row. Add search, status filters, sorting,
  and an Archived Builds view.
- Make New Build the primary action. Ask only for a name, then open Sources.
  Open existing Builds in Plan and provide explicit Checkoff and Production
  status links.
- Archive Builds without removing their history. Keep permanent deletion a
  secondary confirmed action.
- Inventory the local UI primitives and feature components. Mark each one Keep,
  Revise, Merge, or Remove.
- Build the accepted component states in a small development catalog before
  migrating pages.
- Define the accepted theme tokens. Replace or migrate the current tokens and
  legacy global CSS only as each owning component moves.
- Change the application shell and route grouping in small route-level units.
- Give each page one user job and one owner for its state.
- Keep Settings and administrative tools outside the main production path.
- Preserve deep links or provide intentional redirects during the migration.
- Remove obsolete navigation after all callers move.

Repeat the package audit before implementation. Keep unrelated dependency
upgrades out of this phase.

## Data structures

`GlobalSection` is Builds, Production, Printers, or Settings. `BuildSection` is
Sources, Plan, Checkoff, or Production. The two types keep global Production
and Build-scoped Production explicit instead of inferring scope from the route.

## Verification

Static checks run routing, accessibility, component, typecheck, and lint
commands after each route unit.

Runtime checks use `browser:control-in-app-browser` at desktop and phone widths.
Test first use, repeat use, browser back and forward, direct links, keyboard
navigation, empty states, errors, and loading states. Review the component
catalog in dark and light modes before each page migration. Drive every global
section, every Build destination, and the jump between Build Production and
global Production. Legacy Parts and Export links must resolve intentionally.
At the same viewport width, verify that planning remains readable and
Production exposes more concurrent work without shrinking touch targets or
removing accessible names. Verify the Checkoff print layout independently from
the interactive theme. Cover zero, one, and many Builds. Create a Build and
land in Sources, reopen it into Plan, follow status links, archive it, restore
it, and confirm that its Plan, Checkoff, Plate, and Printer job history remain.
