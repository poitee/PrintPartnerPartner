# PrintPartner

PrintPartner turns selected files from several model sources into a physical
build and tracks the required printed parts.

## Language

**Build**:
The top-level physical result that a person or print farm plans and produces.
_Avoid_: Project, profile, job

**Archived Build**:
A Build removed from active work while its Plan, Checkoff sheet, Plates, and
Printer job history remain available.
_Avoid_: Deleted Build, completed Build

**Plan**:
The accepted statement of the parts and quantities required for a Build.
_Avoid_: Build, checkoff sheet

**Plan draft**:
Saved proposed source recompute, file inclusion, and quantity values that do
not change the accepted Plan or the Checkoff sheet until the user explicitly
applies them. A stale draft must be abandoned and rebased onto the current
accepted Plan before Apply.
_Avoid_: Unsaved plan

**Plan revision**:
An accepted version of a Plan created when the user applies the Plan draft.
_Avoid_: Plan version

**Source**:
A reusable repository, marketplace model, local folder, or imported collection
stored in the Source Library. One Source can be attached to several Builds.
_Avoid_: Project, Build source files

**Source Library**:
The Build-independent collection of reusable Sources and their revision
histories.
_Avoid_: Repository list, global Sources page

**Build Source**:
One Build's attachment to a Source. It pins a Source revision and owns that
Build's file selections and naming-rule overrides.
_Avoid_: Source copy, shared file selection

**File selection rule**:
A Build Source choice that includes a directory tree or a specific file, with
explicit file exclusions overriding a broader directory inclusion.
_Avoid_: Imported paths, current checkbox state

**Source revision**:
One immutable, validated snapshot of a Source. A Build remains pinned to its
accepted revision until the user applies a reviewed Plan change.
_Avoid_: Mutable source cache, latest files

**Discovery subscription**:
A followed creator, organization, or collection that may publish Sources the
user has not added to the Source Library.
_Avoid_: Source monitor, automatic import

**Source suggestion**:
A newly discovered project or model offered for review. It is not a Source
until the user adds it to the Source Library.
_Avoid_: Update alert, automatic Source

**Checkoff sheet**:
The electronic, printable, or exported record of the physical parts required
by an accepted Plan and their completion.
_Avoid_: Progress page

**Production**:
The work that prepares Plates and follows Printer jobs through verification.
Inside a Build it shows that Build's work; globally it combines work from all
Builds.
_Avoid_: Export page, farm mode

**Object name**:
The readable name stored on a model object inside a 3MF and carried into the
sliced file when the slicer supports it. PrintPartner uses the name to propose
which required units belong to a Printer job.
_Avoid_: OBJ, object ID

**STL naming rules**:
The conventions that infer a selected STL's filament role and required
quantity from its path and filename. A source can use the app rules or its own
rules.
_Avoid_: Repository detection, naming scheme

**Filament role**:
A planning classification such as primary, accent, clear, or opaque. The role
groups parts for selection and production.
_Avoid_: User role, material type

**Spoolman spool**:
An optional external inventory record used when a Build has a Spoolman
connection. PrintPartner does not otherwise manage filament or printer loads.
_Avoid_: Filament profile, manual filament record

**Inferred quantity**:
The number of physical copies that STL naming rules assign to a selected STL.
A manual quantity can replace it within a Build.
_Avoid_: Automatic multiples

**Required unit**:
One physical copy required by an accepted Plan revision and tracked by the
Checkoff sheet.
_Avoid_: Copy, item

**Plate**:
An arrangement of required units from one Build for one printer's build
volume.
_Avoid_: Batch, bed, mixed-Build Plate

**Print face**:
The face and build-axis orientation authored by the part designer for printing.
Plate arrangement preserves it.
_Avoid_: Automatic orientation, best face

**Source orientation**:
The exact orientation of an STL as imported. PrintPartner keeps it unchanged
during arrangement, and the user makes any rotation in the slicer.
_Avoid_: Plate rotation, automatic orientation

**Arrangement**:
PrintPartner's placement of Printer-allocated required units onto one or more
Plates using projected footprints, spacing, and build size without rotating
them.
_Avoid_: Slicing, automatic orientation, Plater integration

**Plate layout**:
The saved positions of required units on one Plate. The same layout governs
validation and 3MF export.
_Avoid_: Plate preview, temporary packing result

**Plate revision**:
An immutable version of a Plate's Printer, Required unit membership, and saved
layout. Its export filename distinguishes it from older arrangements.
_Avoid_: Plate copy, mutable exported Plate

**Pinned placement**:
A required unit whose position the user has protected from automatic
arrangement.
_Avoid_: Locked Print face, completed part

**Printer**:
A physical machine identified by its user-facing name, model, and build size.
Users assign required units to a Printer before PrintPartner arranges Plates.
_Avoid_: Slicer profile, integration host

**Printer preset**:
An optional template that fills a new Printer's model and build size. The
Printer stores editable values and does not depend on the preset afterward.
_Avoid_: Printer model, slicer machine profile

**Printer connection**:
An optional binding between a Printer and a vendor API used for live status,
sending files, and tracking work. Its reported capabilities determine which
actions PrintPartner offers.
_Avoid_: Printer, slicer profile

**Printer allocation**:
The user's assignment of selected required units to a Printer before Plate
arrangement. A source, directory, filament role, or another visible group can
apply the assignment to several units at once.
_Avoid_: Automatic printer selection, Plate assignment

**Printer job**:
A single attempt to print one Plate on one Printer. It can record an optional
Spoolman spool when that connection is available, whether the slicer or
PrintPartner sent the file.
_Avoid_: Batch, Plate, background job

**Printer job match**:
The association between a detected printer operation and one Plate. Filename
and Object names can propose the match, but the user resolves ambiguity.
_Avoid_: Automatic completion, current Object tracking

**STL bundle**:
A ZIP containing one STL file per required unit selected for a Build. Files
use `role/source/relative-path/filename_unit.stl`. The bundle can contain every
required unit or only the units still missing from Checkoff.
_Avoid_: Source archive, repository ZIP

**Local slicer handoff**:
Export one Plate as a 3MF that the user downloads or opens with an installed
slicer on their computer. The user chooses the slicer, machine profile,
filament profile, and process profile outside PrintPartner.
_Avoid_: Printer slicer assignment, automatic profile selection
