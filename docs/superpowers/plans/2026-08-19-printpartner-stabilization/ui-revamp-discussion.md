# UI revamp discussion

## Purpose

The UI revamp must make the accepted Build workflow easier to understand and
operate. It also needs to leave the frontend with a smaller, consistent set of
components. This is not a theme swap over the current page structure, but a
full theme rebase is allowed after the workflow and site structure are chosen.

## Current frontend

The frontend already uses a current platform stack. `web/apps/web/package.json`
declares React 19, React Router 7, Tailwind CSS 4, Vite 8, TypeScript 6, TanStack
Query 5, Radix primitives, and Vitest 4. On August 19, 2026,
`npm outdated --workspaces --json` returned an empty object.

The component structure needs more work than the dependency set:

- `web/apps/web/src/components` contains 132 TSX files. Twenty-six are local UI
  primitives, and 106 are feature or layout components.
- `index.css` and `App.css` contain 2,222 lines. `App.css` holds 1,858 of them.
- `SourcesPage.tsx`, `CheckoffPage.tsx`, `SettingsPage.tsx`, and `BuildPage.tsx`
  each exceed 900 lines.
- Pages and feature components mix local primitives with native buttons,
  inputs, selects, and tables.
- The router keeps several redirects and legacy names for Build, Review,
  Checkoff, Plate, and Print.
- The current theme has useful semantic tokens, dark and light modes, and a
  separate printable-paper token group.

Regenerate the counts and dependency comparison from the repository root:

```bash
find web/apps/web/src/components -type f -name '*.tsx' | wc -l
find web/apps/web/src/components/ui -type f -name '*.tsx' | wc -l
wc -l web/apps/web/src/index.css web/apps/web/src/App.css
cd web && npm outdated --workspaces --json
```

Native controls and large files are not defects by themselves. The audit must
look for duplicated behavior, inconsistent states, inaccessible interaction,
and unclear ownership before replacing anything.

## Separate package and component maintenance

Package maintenance checks registry versions, release notes, browser support,
peer dependencies, security notices, and build compatibility. Repeat that
check immediately before implementation. Do not combine unrelated major
upgrades with the UI migration.

Component maintenance reviews every local primitive and feature component. Give
each component one status:

- Keep. The component has one clear job and covers its required states.
- Revise. The component belongs in the new flow but needs a corrected API,
  accessibility, responsive behavior, or visual treatment.
- Merge. Another component owns the same interaction or domain rule.
- Remove. The accepted site map no longer needs it.

The audit records callers, owned state, keyboard behavior, loading, empty,
error, disabled, destructive, mobile, dark, light, and print states.

## Accepted Plan interaction

The current Parts page supplies useful behavior, but it does not determine the
new page structure. Carry these parts into Plan:

- Show role and quantity on every item in the selected-parts list.
- Show a source-tree badge only for a non-primary role, a quantity above one,
  or a warning.
- Keep 3D previews, role and source grouping, quantity controls, and warnings.
- Collect naming problems in one exception review.
- Show whether a quantity is inferred or manual. Let the user restore the
  inferred quantity.
- Autosave Plan edits as a draft. Before **Apply plan changes**, show a summary
  of added, removed, and changed requirements.

A source that follows the configured rules adds no separate naming step.

## Accepted navigation

The global navigation has four sections:

- Builds
- Production
- Printers
- Settings

Each Build has four destinations:

- Sources
- Plan
- Checkoff
- Production

Parts is not a separate destination. Its useful selection, preview, grouping,
quantity, and warning behavior moves into Plan. Export is not a separate
destination. Printer allocation, Plate editing, downloads, tracked Printer
jobs, and verification move into Production.

Global Production combines active Printer jobs, Plates awaiting verification,
failures, and recent work from all Builds. It is the farm operator's aggregate
view without creating a separate farm mode.

## Accepted information density

Sources, Plan, and Checkoff use a calm, spacious Build workspace. Production
uses a denser operational layout so Plates, Printer state, failures, and
verification remain scannable during active work.

Both densities use the same tokens, primitives, interaction rules, and status
language. The denser Production layout is not a separate farm interface. It
shows as much concurrent work as the user has.

The printed Checkoff sheet keeps a dedicated paper layout and print tokens.
The interactive Checkoff and its paper layout may both be redesigned, but the
revamp must preserve electronic completion, browser printing, and direct PDF,
CSV, and Excel exports.

## Accepted Builds landing

Builds is the initial section. Use a responsive list rather than switching
between personal cards and a separate farm table. New Build is the primary
action.

Each Build row shows its name, Plan state, Checkoff completion, active Printer
jobs, and work awaiting verification. Search, status filters, sorting, and an
Archived Builds view handle larger collections. On narrow screens, the same
row becomes a stacked item.

New Build asks only for a name and then opens Sources. Opening an existing
Build opens Plan. Explicit status links can open Checkoff or Production.
Archive preserves history. Permanent deletion stays secondary and requires a
deliberate confirmation.

## Visual directions to compare

Build three distinct clickable sketches with the same data and tasks. They
must differ in visual system as well as layout. The current theme is an option,
not a constraint, and at least one sketch must start from a new palette,
typography, spacing, and surface system.

### Workshop ledger

Keep the warm ink, paper, and brass character. Make the Build and checkoff sheet
feel like a clear workshop record. Production data remains secondary until the
user prepares missing parts.

### Production console

Use a compact operational layout. Give printer state, queues, plate estimates,
and exceptions more space. Start with a clean technical visual system rather
than the current workshop theme. This direction favors the farm operator and
may feel heavy for one Build.

### Build and production hybrid

Use a calm Build workspace for sources, planning, and checkoff. Switch to a
denser production workspace for printer allocation, plates, live jobs, and
metrics. Use one visual system across both densities. That system may be new or
may retain selected parts of the current identity.

The hybrid density model is accepted. The prototypes still compare its visual
theme, spacing scale, surface treatment, typography, and action placement.

## Prototype requirements

Each sketch must support the four tasks in
[Phase 0](phase-0-product-decisions.md). It must also show:

- a first visit with no Builds;
- a Build with several source repositories, including one that follows the
  default STL naming rules;
- inferred role and quantity badges, one naming exception, and one manual
  quantity override;
- a stale plan after a source update;
- a long checkoff sheet with some completed units;
- printable, PDF, CSV, and Excel Checkoff output actions;
- missing parts allocated across printers with different build volumes;
- a printer offline or missing its required binding;
- a completed print awaiting verification;
- desktop, tablet, phone, dark, light, and printable checkoff views; and
- keyboard focus and screen-reader names for every action.

## Decisions to make

1. Choose one visual direction or a specific combination from the prototypes.
2. Decide which actions stay visible and which move into secondary menus.
3. Choose the screen sizes that every prototype must cover.
4. Choose whether the UI component catalog is a dedicated development route,
   static fixtures, or a component-workbench tool.

## Completion criteria

The revamp is complete when the accepted workflow needs no legacy page names,
equal actions behave the same everywhere, every component has one owner, and a
real browser test drives the individual and farm tasks. The dependency audit,
accessibility checks, responsive review, dark and light review, and printed
checkoff review must pass at the final commit.
