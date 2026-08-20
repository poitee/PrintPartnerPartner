# Product discussion notes

## Accepted product facts

These facts record the user's product description and decisions from the August
19 discussion.

The product supports both an individual managing projects and a farm operator
planning several builds. They use one core planning workflow. A farm adds more
builds, printers, and concurrent production work rather than a separate mode.

The global navigation is Builds, Production, Printers, and Settings. A Build
contains Sources, Plan, Checkoff, and Production. The logo or initial route can
return to Builds without adding a separate Home section.

Settings uses General, Sources, Connections, Notifications, Account, Data and
system, and Experimental categories instead of one long stack. General owns
appearance, date and time, and application updates. Sources owns default STL
naming rules and monitoring schedule. Connections owns GitHub credentials,
Spoolman, Discord, and outbound webhooks. Notifications owns in-app and
external alert preferences. Account owns security and future multi-user
controls. Data and system owns backups, API keys, logs, storage, and retention.
Experimental contains Docker slicers and unfinished provider integrations.

Printer management leaves Settings for the global Printers section. Source
categories move into the Source Library, and Source-specific naming rules move
to Source detail. Custom filament management, automatic stale-Build recompute,
automatic Source application, and normal-workflow slicer profile assignment are
removed. Monitoring may fetch a revision but never applies it to a Build.
Backups, API keys, logging, theme, date format, account security, GitHub
credentials, Spoolman, application updates, and notification delivery remain.

Assembly tracking remains available as an optional per-Build Checkoff setting,
disabled by default. It does not remain a global application setting.

The current Parts behavior moves into Plan. Printer allocation, Plate editing,
3MF and STL export, Printer job tracking, and verification belong to
Production. The global Production section combines active Printer jobs, Plates
awaiting verification, failures, and recent work from every Build.

Global Production uses Live, Queue, and History views. Live puts Awaiting
verification, failed jobs, unmatched detected operations, and connection
problems first, followed by one compact row per Printer with its current Build,
Plate, status, progress, ETA, elapsed time, and immediate action. A table scales
better than a large-card grid for a farm while remaining useful for one
Printer.

Queue shows Ready Plates across Builds with their Build, Plate revision,
assigned Printer, unit count, export state, tracking mode, and available start
or handoff action. Editing opens that Build's Production workspace; the global
view does not mix Build contents or become another Plate editor. History lists
immutable Printer jobs with Build, Printer, date, and outcome filters, with the
initial operational metrics above it. Build Production reuses these components
filtered to one Build and adds preparation, allocation, and Plate editing.

Sources, Plan, and Checkoff use a calm, spacious Build workspace. Production
uses a denser operational layout for Plates, Printers, status, and
verification. Both densities use one component and theme system. A farm shows
more concurrent rows rather than switching to another interface.

The printable Checkoff sheet keeps a dedicated paper layout. Its print tokens
do not force the interactive site to retain the current paper-and-brass theme.

Builds is the landing section and uses one list-first layout for an individual
or a farm operator. New Build is its primary action. Each row shows the Build
name, Plan state, Checkoff completion, active Printer jobs, and work awaiting
verification. Search, status filters, sorting, and Archived Builds scale that
same list without adding a dashboard mode.

Creating a Build asks only for its name and opens Sources. Opening an existing
Build opens Plan. Status links can jump to Checkoff or Production. Archive is
the normal way to remove a Build from active work while keeping its history.
Permanent deletion remains a secondary, deliberate action.

A build can depend on several source repositories. An LDO Voron Trident can
draw from the Voron Trident repository, the LDO Trident repository, the Voron
Stealthburner repository, and other sources. The user selects the files and
quantities that the build requires. The plan does not include every file from
every source.

The reusable Source Library lives under Builds as a secondary destination, not
as another global navigation item. Its Sources area manages reusable inputs,
its Inbox separates revision updates from discovery suggestions, and its
Following area manages creator and collection subscriptions. A Build's Sources
page shows only the Sources attached to that Build. Add source opens the shared
Library so the user can attach an existing Source or import a new one. Detaching
a Source from one Build does not remove it from the Library.

Attaching a Source makes its files and documentation available to the Build but
does not make any printable file required. Plan owns required-part selection.
It lets the user browse by Source and directory, select visible groups or
individual files, search, preview parts, and review naming-derived roles and
quantities. A documentation-only Source is valid. The first accepted version
uses Create plan; later drafts use Apply plan changes with an added, removed,
and changed summary before Checkoff changes.

A selected directory is a durable File selection rule, not a one-time copy of
the directory's current files. New printable files inside it appear in the next
Plan draft but do not change Checkoff until the user applies that draft.
Explicit file exclusions override the directory rule. An exact content rename
carries its selection into the draft, a modified selected file receives a
review warning, and a removed selected file requires resolution. The Source
tree shows none, some, or all selected for each directory.

Bulk selection from search results, naming groups, inferred roles, or other
filters selects the files currently visible. It does not create a rule that
selects future matches. Selecting a directory or the Source root remains the
way to create a durable rule. Manual quantity and role overrides belong to the
Build and win over inference. An exact rename retains the selection and manual
overrides, but Plan flags any inference change caused by the new path or name.

Applying a Plan revision reconciles Checkoff without deleting production
history. Unchanged files and exact renames retain completed Required units.
Reconcile retained Required units in stable token order, with completed units
first. Quantity increases preserve every existing token and append new Missing
units with new tokens. Quantity decreases retain completed units first, then
the earliest remaining tokens until the new quantity is met. If completed
units already exceed the new quantity, keep all completed units in production
history, show the accepted requirement as satisfied with an explicit surplus,
and do not relabel or delete any token. Intentional part removal follows the
same history rule. If selected file contents or its filament role changed, the
user decides whether completed prints still satisfy the new requirement or
need reprinting. If a selected file disappeared upstream, the user must map a
replacement, remove the requirement, or keep the older Source revision before
applying the draft. Durable Object names use these reconciled tokens.

Checkoff remains a focused electronic and exportable checklist for the accepted
Plan. Its visual design and component structure may change completely. It must
retain individual and bulk completion, manual corrections, grouping, filters,
and clear Required unit state. An unapplied Plan draft does not change the
sheet; Checkoff shows a Review in Plan notice instead. Prepare missing parts is
its main transition into Production. Printer allocation and Plate editing do
not move into Checkoff. A completed Printer job reaches Awaiting verification,
and confirming its Plate completes the affected units; manual checkoff remains
available for work printed outside PrintPartner.

Checkoff supports browser printing and direct PDF, CSV, and Excel exports. The
paper and PDF layouts identify the Build, accepted Plan revision, generation
date, part name, required quantity, filament role, Source path, and physical
checkboxes. CSV and Excel provide structured Checkoff data for external use.
These remain practical handoffs for the builder, farm operator, or customer
rather than full technical reports.

Print and PDF can export current progress or a blank physical checklist. CSV
contains one row per Required unit so copies remain traceable. Excel contains a
Parts worksheet with required, completed, and remaining counts plus a Units
worksheet with each unit's state, Source, role, completion time, Plate, Printer
job, notes, and optional assembly state. Every output is a snapshot of the
accepted Plan and completion state with the Build, Plan revision, and generation
time in its metadata and filename. Spreadsheet import is outside the first
version; PrintPartner remains the Checkoff authority.

The Checkoff sheet is a key product output. It must remain useful electronically
and when printed or exported for the builder, farm operator, or customer. The
revamp preserves the capability and workflow, not the current styling, layout,
or component structure.

Preparing only the missing parts is a key operation. A user must be able to
choose printers, divide required parts by source, directory, or another useful
group, and arrange the selected parts on plates that respect each printer's
build volume.

Exported objects need an identity that printer APIs can relate back to the
planned physical unit. That identity supports live status, time estimates,
completion, and later production metrics.

"Objects" means the named model objects inside each exported 3MF, not files in
the `.obj` format. Their readable names are the cross-system tracking contract.
PrintPartner maps those names to checkoff units before a tracked send or when it
discovers a printer job.

Build is the canonical name for the top-level work being planned. Project,
profile, and job should not label that concept in product language.

The current ink, paper, and brass theme is not a constraint. The UI revamp may
replace its palette, typography, spacing, surfaces, and component styling if a
different visual system serves the accepted workflow better.

STL naming rules belong in Plan. PrintPartner interprets selected STL paths to
infer filament roles and quantities. A conventional source should need no
extra step. Plan must show the inferred values, call attention to exceptions,
and preserve manual quantity overrides.

Filament roles remain useful for naming-derived grouping. PrintPartner does not
require planned filament, manual filament inventory, or loaded-filament state.
The user decides which Printer receives the parts and handles material, color,
and profiles in the slicer.

Spoolman is the one optional filament-management path. When a Spoolman
connection exists, PrintPartner can let the user select its spool records for
tracking and usage deduction. Without Spoolman, the workflow has no filament
setup, matching, or readiness warnings.

Plan should reuse the useful behavior from the current Parts page without
preserving that page's structure. The selected-parts list always shows role and
quantity. The source tree shows badges only for non-default values and
warnings. Keep previews, grouping, quantity controls, and warnings. Collect
naming problems in one exception review.

Source, file selection, and quantity edits autosave into a Plan draft. They do
not change Checkoff immediately. **Apply plan changes** shows the added,
removed, and changed requirements, then creates a Plan revision that Checkoff
uses. Completed work for unchanged required units must survive the revision.

Production starts when the user selects **Prepare missing parts**. The
Production workspace assigns missing required units directly to Plates. A
Plate belongs to one Build and one printer. Each sent or tracked Plate becomes
a Printer job. The farm view combines Plates and Printer jobs from several
Builds without combining their parts.

A Printer has a user-facing name, model, and build size. Build size is the
planning limit used to test fit and arrange Plates. Printer integrations and
slicer profiles do not define these three properties.

A Printer can exist for planning without a Printer connection. The optional
connection owns vendor API details, live status, file sending, and job
tracking. A local 3MF export does not require one.

Adding a Printer starts with a Printer preset or Custom. A preset fills the
model and X, Y, and Z build size. PrintPartner copies those values onto the new
Printer, keeps the optional preset reference for context, and lets the user
edit the values later. Choosing a preset does not bind the Printer to a slicer
machine profile.

Printer connection setup is a separate optional step after the physical
Printer exists. The Printer settings flow does not require Moonraker,
PrusaLink, or Bambu credentials before the machine can be used for planning.

The Printers section lists each physical Printer's name, model, build size,
connection health, current job, last contact, and action-needed state. Its
detail view owns editable physical properties, optional connection setup and
capabilities, Test connection, recent connection health, production history,
and Archive. Changing or removing a connection does not change the Printer or
its history.

Changing build size affects future allocation and draft Plates. Existing
drafts for that Printer become Needs revalidation. Exported, Printing,
Awaiting verification, and completed Plate revisions retain the Printer
dimensions recorded when they were created. Archiving removes a Printer from
new allocation while retaining its history and allowing restoration. Permanent
deletion is available only when the Printer has no production history.

The user chooses the Printer for the work. PrintPartner does not automatically
choose a Printer. The user can select required units one at a time or select a
visible group such as source, directory, or a category inferred by STL naming
rules. Applying a Printer to a group assigns each selected required unit while
keeping the units individually traceable.

Printer allocation uses an Unassigned area beside the Printers the user chose.
Each Printer shows its name, model, build size, optional connection state,
assigned-unit count, and an automatic Plate-count preview. The user can move
individual units or assign the current Source, directory, role, or visible
selection as a group. Copies remain separate and may go to different Printers.
The user can leave work Unassigned and move units between Printers before
arrangement.

PrintPartner tests each unit against the Printer's X, Y, and Z limits without
changing Source orientation. An incompatible Printer is unavailable for an
individual unit. A bulk assignment moves the compatible units and leaves every
non-fitting unit visibly Unassigned with its reason. PrintPartner does not send
those units to another Printer automatically. Filament and slicer profiles do
not appear in allocation.

Printer allocation happens before arrangement. PrintPartner then arranges the
units allocated to each Printer into one or more Plates for that Printer's
build size. The user can skip arrangement and use a direct export path.

Plate arrangement must preserve the Print face authored in the source STL.
PrintPartner must not guess a different face because build-axis orientation can
be part of the designer's layer-adhesion and strength intent. PrintPartner does
not rotate parts around any axis. The user can rotate them later in the slicer.

The Plate workspace is an in-page editor, not a text-only preview or an
external Plater application. Its default view is a top-down printer bed with
the actual part shapes. A separate 3D inspection mode lets the user orbit the
view without changing the Print face.

The automatic Arrangement creates an editable draft. The user can select and
move units, pin placements, return units to an unplaced list, and move units to
another Plate or Printer. It has no rotation control. Live validation
identifies overlaps, spacing violations, bed-boundary violations, and excessive
part height.

Arrange unplaced fills available space without moving pinned or manually
placed units. Arrange all can replace the current layout only through an
explicit action with undo. PrintPartner saves each required unit's exact Plate
and position. Preview, validation, and 3MF export use that saved Plate layout
without repacking it during export.

Each Plate has a stable identity and immutable Plate revisions. Changing its
Printer, Required unit membership, or saved positions creates a new revision.
Export filenames identify the Build, Plate, and revision, for example
`ldo-trident-300__plate-03__r02.3mf`. Re-downloading an unchanged revision keeps
the same filename and contents. Required unit Object names stay stable across
layout revisions. Older revisions remain identifiable if the user prints an
older download.

Each Required unit receives its exported Object name when the accepted Plan
creates that unit. Store the name with the Required unit instead of deriving it
again during export. Use a readable sanitized part stem plus a stable,
filesystem-safe Required-unit token, for example
`bracket__pp_7K2M_02`. Preserve the token when a later Plan revision carries
the same durable unit forward; create a new token when it creates a different
unit. The token, not the basename, disambiguates equal filenames from different
Sources.

Resolve exact persisted Object names only inside a candidate Plate revision
whose artifact digest or manifest identity already matches the observed job.
A stable Required-unit name cannot select a Plate revision by itself. If more
than one historical artifact remains possible or their Object-name sets are
not unique, require confirmation. Legacy normalized basename matching is also
an ambiguous proposal. Never silently choose between equal basenames. Every
Plate revision and Printer job stores the Object-name-to-Required-unit mapping
it used. Multi-copy round trips and cross-Source basename collisions must pass
through a real supported slicer before this evidence can complete units.

Matching a Printer job locks that Plate revision. Printing, Awaiting
verification, and Complete revisions cannot be edited. Retry can reuse the
same failed layout; Edit and retry creates a new revision. A multi-Plate ZIP
contains the revisioned 3MF files and a `print_plan.json` manifest with their
Build, Printer, Plate revision, and Required unit Object-name mappings.

PrintPartner does not enforce one filament per Plate. The user chooses which
parts share a Plate and handles filament assignment and tool-slot mapping in
the slicer.

Do not use Batch as a general name for a Plate or a group of Plates. Users can
understand Batch as repeated copies of the same part. Reserve that word until
PrintPartner supports that specific operation.

A required unit can belong to only one active Plate. Its production state moves
through Missing, Assigned, Printing, Awaiting verification, and Complete. A
successful Printer job stops at Awaiting verification until the user confirms
the physical result. A cancelled or failed Plate releases its units to Missing
or lets the user reassign them.

Prepare missing parts opens Production with every Missing Required unit
selected. The user can clear individual units or groups before choosing Prepare
Plates or Direct export. Prepare Plates uses Printer allocation, arrangement,
saved Plate layouts, named-object 3MF export, Printer job matching, and physical
verification. Direct export skips Printer allocation and arrangement and offers
one unarranged named-object 3MF or an STL bundle ZIP for the selected units.

Direct export is a manual-tracking path. A slicer may rearrange or split its
objects into work that has no saved PrintPartner Plate. A Printer connection
that reports Object names can still propose Required unit matches, but the
product must not promise Plate matching when the connection lacks that data.
The exported Object names remain stable so later or more capable integrations
can use them.

PrintPartner groups required units into Plates and exports each Plate as a 3MF.
The immediate handoff is local: the user downloads the 3MF or asks the operating
system to open it with an installed slicer. PrintPartner does not assign a
slicer application, machine profile, filament profile, or process profile to a
printer. The user makes those choices inside the slicer.

Tracking does not require PrintPartner to send the sliced file. The normal path
is for the user to slice and send through the installed slicer. A Printer
connection detects the active operation and proposes the matching Plate from
the stable Plate filename and preserved Object names. The user confirms any
ambiguous match.

When a Printer connection supports uploads, PrintPartner can offer upload as
an optional shortcut. It is not the primary handoff and must not appear on
connections that lack that capability. PrintPartner never moves a sliced file
to another Printer automatically because matching build size does not prove
that machine-specific output is compatible.

After a Printer job match, PrintPartner shows the status, progress, and ETA
reported by that connection. Completion moves the Plate to Awaiting
verification. It does not complete required units until the user confirms the
physical result.

Printer job matching uses evidence levels. An exact unique Plate revision
filename matches automatically and offers Undo. Object names that identify one
Plate revision despite a changed filename produce a proposal that requires
confirmation. Missing or ambiguous filename and Object evidence requires the
user to choose the Plate. Printer, start time, or matching build size alone is
not enough evidence.

A Printer without a connection uses the same lifecycle manually. Start
manually locks the Ready Plate revision and records its start time. The user
then marks the Printer job finished, failed, or cancelled. Finished still means
Awaiting verification. A connection automates observation but does not define
the production states. The UI shows only status, progress, ETA, and other facts
that the connection actually reports.

Awaiting verification offers All parts good or Review parts. Review parts lets
the user identify failed or missing Required units. Successful units become
Complete; failed units return to Missing or enter a retry selection. The
immutable Printer job records Success, Partial success, Failed, or Cancelled.
A total failure returns every unit to Missing. A retry may reuse the exact
Plate revision or create an editable replacement revision.

Printer job history captures the Printer, Build, Plate revision, Required
units, start and end times, actual duration, reported starting estimate when
available, outcome, failed units, optional reason, retry relationship, tracking
method, and Plate footprint utilization. Spool usage exists only when Spoolman
provides it. A multi-object Plate has one measured duration; PrintPartner does
not fabricate per-part durations by dividing it among the objects. Initial
reporting stays limited to Printer hours, successful jobs, failure rate,
completed units, retries, and estimate accuracy.

Docker-hosted and automatic slicing are deferred. The local handoff must not
claim that a file was opened when the browser or operating system only
downloaded it. An unavailable local-open action falls back visibly to Download
3MF.

The user can also download one STL bundle ZIP for the Build. This is separate
from the arranged Plate 3MFs. It supports manual arranging, sharing, and
archival. Keep the existing missing-only STL bundle for production work that
should exclude completed units.

The STL bundle contains one file per required unit. Its directory contract is
`role/source/relative-path/filename_unit.stl`. This preserves inferred quantity,
repository identity, the complete source path, and the unit suffix when the
files leave PrintPartner.

Canonicalize each archive path before writing: normalize separators to `/`,
remove empty and `.` segments, reject `..`, absolute paths, control characters,
and platform-reserved names, and sanitize each role, Source, directory, and
filename segment with one shared function. Resolve the final path and prove it
stays below the bundle root. Build the complete list first; if two inputs
produce the same case-folded archive path after sanitization, fail the export
with both conflicting Source paths instead of overwriting either file.

Marketplace API integration is a later project. PrintPartner should investigate
supported and undocumented interfaces for Printables, MakerWorld, and Thangs,
including creator discovery, model revisions, metadata, file listings, and
downloads. The core Source Library and revision workflow must continue to work
through URLs and manual imports, so it does not depend on unstable private
website calls. A future provider adapter must have an acceptable authentication
path, usage terms, rate behavior, and failure mode before it becomes a supported
integration.

## Code observations

The current domain already represents a required copy as `match_key + unit`.
It supports missing-only export, printer-specific plate layouts, grouping by
source location, and basic packing against printer bed dimensions.

The current packer uses a shelf layout. It is not yet equivalent to a slicer's
arrange operation. It warns when a part exceeds the printer's Z limit but still
places that part.

[Rhoban Plater research](plater-research.md) confirms that Plater rasterizes
each part's top-view footprint, tests Z-axis rotations, and creates more Plates
as needed. PrintPartner uses the footprint, spacing, and overflow behavior only
as a reference. It does not copy Plater's rotation behavior. Plater's released
exporter merges the Plate into one STL, so PrintPartner keeps responsibility
for named-object 3MF export.

Plater is a behavior reference only. PrintPartner will not add its package,
binary, source code, or exporter. The new Arrangement engine is owned by
PrintPartner and verified against PrintPartner fixtures.

The current 3MF export keeps a display name based on filename and unit number.
The current printer flow tracks the Plate or Printer job by filename and
status. It uses object names to propose required units, then stores
`part_id + unit_index` on the Checkoff link. It does not track which object is
currently under the nozzle.

Generated multi-copy 3MF names use `filename.stl (2)`. Missing-STL exports use
`filename_02.stl`. Tests cover both formats separately, but no automated test
proves the generated 3MF name survives a real slicer and maps back to the same
unit.

Phase 10 adds a release-gated supported-slicer fixture without replacing those
format tests. It covers multiple copies and equal basenames from different
Sources, inspects the slicer's resulting Object names, and proves each name
maps back to the same Required-unit token.

The current STL pack already creates a ZIP after copying one STL per required
unit. It groups files by filament role and can add a sanitized parent-folder
label. It does not retain repository identity or the complete nested source
path. The revised workflow should retain the engine and rename the action to
Download STL bundle.

The current Printer preset creation path copies dimensions and filament-slot
count but discards the preset's model identity. The current settings UI also
requires a Printer connection before it creates the Printer. Both behaviors
conflict with the accepted Printer creation flow.

The current code stores filament choices on Parts and Printer slots, then uses
them for automatic Printer selection. The revised workflow removes that
authority. Spoolman references remain optional inventory data and must not
choose a Printer or constrain a Plate.

## Open decisions

- Decide which cross-build production and metrics views a farm operator needs
  in the next release.
- Determine the smallest supported local mechanism for **Open with...** on each
  desktop platform. Preserve Download 3MF as the universal fallback.
