# Phase 9: create one production-operation owner

[Back to the overview](overview.md)

## Goal

Place preparation, printer assignment, sending, verification, and completion
under the owner accepted in Phase 0.

## Changes

- Move one production operation at a time behind explicit domain commands.
- Assign missing required units directly to Plates for one Build.
- Prevent a required unit from belonging to more than one active Plate.
- Store a Printer's user-facing name, model, and build size as its planning
  properties.
- Create a Printer from an optional Printer preset or Custom values. A preset
  fills the model and X, Y, and Z build size. Store editable values on the
  Printer and retain the optional preset reference for context.
- Let a Printer exist without a Printer connection. Require the connection only
  for vendor API actions such as status, file sending, and job tracking.
- Move Printer connection setup into a separate optional step after Printer
  creation. Do not require vendor credentials for planning or local export.
- Let the user allocate individual required units or visible groups to a
  Printer. Do not automatically select a Printer.
- Arrange each Printer's allocated units into Plates only after allocation.
- Keep filament roles as optional grouping shortcuts. Do not require filament
  setup, inspect Printer loads, or constrain which roles can share a Plate.
- Preserve each source STL's exact Source orientation during arrangement.
  PrintPartner moves parts but never rotates them.
- Replace shelf packing with a PrintPartner-owned footprint Arrangement engine.
  Do not add Plater code, binaries, packages, or services.
- Replace the text-only Plate preview with an in-page Plate editor. Use a
  top-down bed as the default editing view and provide a separate 3D inspection
  mode.
- Render the actual part shapes and let the user select and move units. Leave
  every rotation control to the slicer.
- Let the user pin placements, return units to an unplaced list, and move units
  to another Plate or Printer.
- Make Arrange unplaced respect pinned and manually placed units. Make Arrange
  all an explicit, undoable replacement of the current layout.
- Validate overlap, spacing, build-area bounds, and printer height while the
  user edits. Repeat authoritative validation on the server before export.
- Give Plates stable identities and save each placed required unit's X and Y
  position. Preview and 3MF export must consume this exact layout without
  repacking it.
- Provide a direct export branch that skips PrintPartner arrangement.
- Use each selected printer's build volume when arranging units and estimating
  the required Plate count.
- Require an explicit Printer for each Plate. Require a Printer connection only
  when the user requests a vendor API action.
- Export each prepared Plate as its own 3MF.
- Give each exported Plate a stable filename and preserve its Object names so
  a Printer connection can propose a Printer job match after slicer handoff.
- Create an immutable Plate revision for every exported layout. Bind each
  Printer job to that exact Plate revision or exported-artifact digest and
  persist the Object-name-to-Required-unit mapping used for the job.
- Offer Download 3MF and a capability-checked local **Open with...** action.
  Fall back visibly to download when the local platform cannot open the file.
- Offer Download all STLs as one Build-scoped ZIP. Retain Download missing
  STLs for a ZIP that omits completed required units.
- Write one file per required unit to
  `role/source/relative-path/filename_unit.stl` inside each STL bundle.
- Keep slicer application choice and machine, filament, and process profile
  choice inside the user's slicer. Do not bind them to the printer record.
- Remove imported slicer profile controls from the local handoff workflow.
  Retain their data only for deferred automatic slicing work.
- Preserve the readable 3MF object names that the existing slicer and printer
  API parsers use.
- Preserve `match_key + unit` during Plate planning and the resolved
  `part_id + unit_index` mapping on a tracked Printer job.
- Treat direct sending from the user's slicer as the normal path. Detect the
  active printer operation and propose its Plate from the filename and Object
  names.
- Require user confirmation when a Printer job match is ambiguous.
- Offer upload through PrintPartner only when the selected Printer connection
  reports upload capability. Hide unsupported actions.
- Never move a sliced file to another Printer automatically.
- Remove fallback-to-first-printer behavior.
- Move successful Printer jobs to Awaiting verification. Mark their required
  units complete only after the user confirms the physical result.
- When Spoolman is connected, allow an optional Spoolman spool reference on the
  Printer job for inventory tracking and usage deduction. Do not create a
  separate manual filament inventory model.
- Persist one Spoolman deduction result keyed by Printer job. Apply it only
  after the job first reaches its terminal completed state so repeated polls,
  webhooks, and retries cannot deduct usage twice.
- Release or reassign required units after Plate cancellation or failure.
- Remove duplicate completion controls after their callers migrate.

Docker-hosted slicing, automatic slicing, manual filament management, and
durable background execution remain out of scope for this phase.

## Data structures

`RequiredUnit` identifies one physical copy from the accepted Plan revision. A
`PrinterAllocation` records the user's Printer choice for a required unit
before arrangement. A `Plate` has a stable identity and owns selected required
units from one Build, one Printer, the Plate layout, the exported artifact, and
the resolved Checkoff mappings. Each placed required unit records its X and Y
position and whether the user pinned it. Unplaced units remain separate from
the Plate layout. A `PrinterConnection` optionally binds the Printer to a
vendor API. A `PrinterJob` owns one attempt to print a Plate. It records the
Printer, immutable Plate revision or exported-artifact digest, corresponding
Object-name mapping, optional Spoolman spool and deduction result, external
operation IDs, status, and failure details. A `PrinterJobMatch` associates an
operation discovered through the Printer connection with one exact exported
Plate revision. It stores the evidence and whether the user confirmed an
ambiguous proposal.

## Verification

Static checks run domain, service, route, component, typecheck, and lint checks
for each migrated operation.

Runtime checks prepare a real test artifact, assign an explicit emulated
printer manually, apply one grouped assignment, arrange its units, send it,
observe status, verify completion, and exercise one failed
binding. The failed binding must stop before any external action. Download and
local-open paths must produce the same named-object 3MF. The full STL bundle
must contain every selected STL, and the missing-only bundle must exclude
completed units. Both ZIPs must preserve role, source, relative path, and unit
suffix without filename collisions. A local-open failure must leave the user
with an explicit download path. A second
active Plate must not claim an assigned required unit. A failed Plate must
release or reassign its units. The check must trace every exported object name
back to its required unit after a real slicer handoff. Cover the first copy,
later copies, and missing-only export. A duplicate basename from different
sources must remain visibly ambiguous rather than map silently to the wrong
unit. A non-square orientation fixture must retain its exact Source orientation
before and after arrangement. Drag one unit, pin it, and run Arrange unplaced.
The pinned unit must not move. Save and reopen the Plate, then export it. The
editor, server validator, and 3MF must report the same Plate, X position, and Y
position for every required unit. Collision, spacing, boundary, and height
violations must block that Plate's export. Arrange all must support undo without
changing required-unit identities. Planning and local 3MF export must work for
a Printer with no Printer connection and without any filament setup. With
Spoolman connected, a selected spool must stay attached to its Printer job and
receive one usage deduction across repeated completion polls, webhooks, and
retries. A Printer created from a preset must retain its model
and build size after the preset changes or disappears. Custom and
preset-derived Printers must allow later edits without requiring a Printer
connection. Send a Plate directly from a slicer and let the Printer connection
discover it. A unique filename and Object-name match must create the expected
Printer job proposal. An ambiguous match must wait for user confirmation.
Completion must stop at Awaiting verification. Repeat the flow through an
upload-capable connection and prove it creates the same Printer job identity.
Connections without upload capability must not show that action. A sliced file
must never move to a different Printer automatically. Edit and re-export the
Plate after one job starts and prove the original job still resolves against
its original artifact and Object-name mapping.
