# PrintPartner stabilization plan

## Context

PrintPartner has a useful core product. A person building one project and a
farm operator planning several builds need the same core workflow. They combine
the required model sources, select the files needed for each build, produce a
parts checklist, prepare the remaining parts for selected printers, and track
completion. Current CI is healthy, but several parts of the product tell
different stories about that workflow. Source synchronization also has
correctness gaps that can place deleted or incomplete files into a plan.

This plan preserves the August 19 review in [findings.md](findings.md). The
workflow and site model are accepted, and Phases 1 through 3 are implemented.
Later phase files preserve their accepted scope; implementation still proceeds
one verified phase at a time.

[Discussion notes](discussion-notes.md) preserve the product facts and open
questions that emerge during that conversation.

[3MF object tracking research](3mf-object-tracking.md) records the existing
name-preservation, printer API, and checkoff flow.

[STL naming rules](stl-naming-rules.md) records how selected file paths produce
inferred quantities and filament roles.

[Rhoban Plater research](plater-research.md) records its orientation model,
footprint algorithm, output limits, integration choices, and license constraint.

[UI revamp discussion](ui-revamp-discussion.md) records the frontend baseline,
prototype directions, component audit, and open visual decisions.

## Definition of done

The stabilization program is done when all of these statements are true:

- A new self-hosted user can add a source, build a plan, prepare a print, and
  record completion without meeting two controls that claim the same action
  but behave differently.
- A farm operator can plan several builds with the same planning workflow, then
  view and manage production work across those builds.
- A successful source sync represents one complete upstream revision. Deleted
  files disappear, incomplete GitHub trees fail visibly, and dependent plans
  become stale.
- The navigation, page ownership, progress indicators, help text, and
  screenshots describe the same workflow.
- The electronic and printed checkoff sheets represent the same required
  physical units.
- Plate planning uses the selected printers' build volumes and preserves the
  identity of every required unit through export and printer tracking.
- Planning shows the filament role and quantity inferred from each selected
  STL. Users can review exceptions and replace an inferred quantity.
- Source, selection, and quantity edits autosave into a Plan draft. Checkoff
  changes only after the user reviews and applies that draft.
- Production assigns missing required units directly to Plates. Each Plate
  belongs to one Build and one printer.
- A Printer has a user-facing name, model, and build size. The user allocates
  required units or visible groups to Printers before arrangement.
- PrintPartner arranges each Printer's allocated units into Plates unless the
  user chooses direct export.
- Plate arrangement preserves the source STL's authored Print face. It never
  guesses a new build-axis orientation.
- PrintPartner owns the Arrangement engine. Plater is a behavior reference,
  not a runtime or source dependency.
- Each Plate exports as a named-object 3MF for Download or a local **Open
  with...** action. The user selects the slicer and all slicer profiles outside
  PrintPartner.
- A Build can download one STL bundle ZIP containing all selected STL files.
  Missing-only production can download a second bundle that excludes completed
  units.
- The STL bundle contains one file per required unit under
  `role/source/relative-path/filename_unit.stl`.
- Shared contracts describe API responses, and the browser validates external
  data before feature code consumes it.
- One browser test drives the supported workflow against the real web and
  server applications.
- A release tag identifies the commit that produced the published image and
  GitHub release.
- Documentation labels Postgres, S3, multitenancy, and durable background work
  according to what the code supports.

## Scope

This plan includes both single-build and farm workflows in the supported
self-hosted product. It covers source correctness, release repair, the main
workflow, the site structure, frontend state ownership, API contracts,
end-to-end verification, and documentation.

This plan does not include a SaaS launch, a general print-farm ERP, a mobile
application, or more third-party integrations. A full UI theme rebase is in
scope when the accepted prototype calls for it. Durable jobs,
async Postgres repositories, shared object storage, and tenant-aware workers
need a separate program if SaaS becomes a near-term goal.

## Constraints

- Keep SQLite and local storage as the supported deployment until another
  backend passes the same runtime checks.
- Preserve existing user data and manifests.
- Treat the current industrial visual language as one prototype input, not a
  requirement. The accepted UI may use a new theme.
- Prefer deletion and consolidation over new wrappers.
- Do not split large pages until the plan settles domain and state ownership.
- Keep each implementation phase independently shippable and verified.
- Do not start a later phase while the current phase has an inconclusive check.

## Accepted workflow decisions

- Build is the top-level object.
- Plan owns sources, selected files, inferred metadata, and required
  quantities.
- Checkoff records the completion of required units.
- Production owns Plate preparation, printer assignment, export, sending,
  tracking, and verification.
- Global navigation is Builds, Production, Printers, and Settings.
- Each Build contains Sources, Plan, Checkoff, and Production.
- Global Production combines work from several Builds. It does not create a
  separate farm mode.
- Parts is absorbed into Plan. Export is absorbed into Production.
- Production assigns required units directly to Plates. It does not create an
  intermediate batch.
- Each Plate belongs to one Build and one printer.
- Printer selection is manual. Group assignment is a shortcut for applying the
  user's choice to several required units, not an automatic routing rule.
- PrintPartner does not bind a slicer application or slicer profiles to a
  printer. It exports the Plate 3MF for local download or opening.
- A Build can export all selected STLs as one ZIP independently of Plate 3MF
  export.
- STL bundle paths preserve filament role, source identity, relative path, and
  required-unit suffixes.
- The farm view combines Plates and Printer jobs from several Builds without
  creating another planning workflow.

## Open decisions

Later UI work still owns these decisions:

1. Which Production actions stay visible at each information density?
2. Which visual direction should the UI prototypes use?
3. Is SaaS a near-term product commitment or an experimental branch of the
   architecture?

## Accepted site structure

The global shell has Builds, Production, Printers, and Settings. Builds is the
return destination and list of work. Production is the cross-Build operations
view. Printers manages physical machines and optional connections. Settings
holds application and integration configuration.

A Build has Sources, Plan, Checkoff, and Production. Sources brings model
collections into the Build. Plan selects required parts and quantities.
Checkoff owns the electronic and printable completion record. Production owns
Printer allocation, Plate preparation, export, Printer jobs, and verification.

The clickable prototypes compare visual direction, responsive behavior, and
action placement against this accepted navigation and density model. They do
not reopen the old Parts and Export page boundaries.

## Phases

1. [Decide the workflow and site structure](phase-0-product-decisions.md)
2. [Define source revision identity](phase-1-source-revision-model.md)
3. [Make source sync atomic](phase-2-atomic-source-sync.md)
4. [Invalidate plans after source changes](phase-3-plan-invalidation.md)
5. [Repair release identity](phase-4-release-repair.md)
6. [Make API contracts authoritative](phase-5-contract-boundary.md)
7. [Give server state one frontend owner](phase-6-state-ownership.md)
8. [Encode the accepted workflow](phase-7-workflow-model.md)
9. [Reshape the site around the accepted workflow](phase-8-site-structure.md)
10. [Create one production-operation owner](phase-9-production-workspace.md)
11. [Prove the real user journey and update documentation](phase-10-e2e-and-docs.md)
12. [State the supported platform boundary](phase-11-platform-boundary.md)

Read [testing.md](testing.md) for the program-level checks.

## Implementation guidance

Future implementation work must use these project skills:

- Use `how` before changing an unfamiliar subsystem.
- Use `architect` before introducing a new cross-module boundary.
- Use `typescript-best-practices` for every TypeScript or TSX change.
- Use `tdd` for the source-sync defects and other changes with a cheap
  regression-test target.
- Use `browser:control-in-app-browser` to reproduce and verify site behavior.
- Use `interrogate` before shipping a contested workflow design.
- Use `show-me-your-work` for the program decision trail.
- Use `unslop` for product copy, documentation, commit messages, and PR text.
- Use `code-review` before each implementation phase is handed back.

Apply Foundational Thinking by settling the source-revision and workflow data
models before distributing behavior across callers. Apply Experience First by
testing workflow sketches with real tasks before choosing the easiest layout to
implement. Apply Sequence Work into Verifiable Units by shipping each phase
with its own check. Apply Prove It Works by driving the real application rather
than treating component tests as proof of the user journey.

## Current stop point

Phases 0 through 3 are complete. Phase 4's local release repair is implemented
and prepared for `3.2.0`; the phase remains open until an explicitly approved
tag push proves the public image, release asset, and runtime identity. Later
phases remain documented but have not started.
