# Phase 0: decide the workflow and site structure

[Back to the overview](overview.md)

## Goal

Agree on the shared planning model for an individual builder and a farm
operator. Define the workflow states, page ownership, site navigation, and
product vocabulary before changing production UI.

## Changes

- Create a short decision record beside this plan.
- Map the current workflow with the real actions and state changes behind each
  page.
- Place STL naming inference and exception review inside the planning flow.
- Compare the linear workflow, the production-loop workflow, and the project
  dashboard against the same user tasks.
- Build two or three throwaway clickable sketches with realistic PrintPartner
  data.
- Compare the visual directions and frontend requirements in the
  [UI revamp discussion](ui-revamp-discussion.md).
- Choose the site map and workflow after walking through each sketch.
- Record rejected alternatives and the reason for rejection.

Do not edit production pages in this phase.

## Data structures

Define a small vocabulary before UI work. `Build` is the accepted top-level
term. `Plan`, `Plan draft`, `Plan revision`, `STL naming rules`, `Filament role`,
`Inferred quantity`, `Required unit`, `Plate`, and `Printer job` are accepted
terms. Do not use `Batch` for general Plate preparation. The discussion can add
terms when a later decision needs them.

## Conversation agenda

1. Walk through the shared planning path without using existing page names.
2. Identify the extra cross-build views that a farm operator needs.
3. Decide where planning ends and production begins.
4. Decide whether completion belongs to a part, a print unit, or a production
   run.
5. Compare the navigation sketches with first-use and repeat-use tasks.
6. Choose one vocabulary and one site map.

## Prototype tasks

Use the same tasks for every sketch:

1. First use. Add and sync a model source, create the planning object, and find
   the parts that need to be printed. Confirm one inferred role and quantity
   without opening a separate naming step.
2. Source update. Sync a changed source, understand that the existing plan is
   stale, review the draft changes, and apply a new Plan revision without
   losing completed work or intentional choices.
3. Production. Prepare only the remaining required units, choose the intended
   units manually or by source, directory, or naming-derived group. Allocate
   those units to user-chosen Printers. Arrange the units on Plates for each
   Printer's build size or choose direct export. Then
   export one named-object 3MF per Plate, download it or open it with a local
   slicer, download the Build's STL bundle ZIP, and record completion. The user
   chooses machine, filament, and process profiles inside the slicer.
4. Farm overview. Repeat the planning flow for a second build, allocate work
   across several printers, and identify which build, plate, and required unit
   each active printer job represents.

## Decision gate

This phase passes only when the user accepts:

- one primary workflow model,
- one model shared by individual and farm use,
- one owner for printer operations,
- one meaning for Parts and completion,
- one main navigation model,
- one set of action names,
- one behavior for inferred part metadata, exceptions, and manual overrides,
- one manual Printer-allocation flow with grouping shortcuts,
- one choice between PrintPartner arrangement and direct export,
- one honest local 3MF handoff with Download as its universal fallback,
- one visual direction and information-density model,
- and the supported deployment goal for the next release.

## Verification

Static verification checks that the decision record defines each chosen term
once and resolves every open workflow question in the overview.

Runtime verification uses `browser:control-in-app-browser` to drive all four
prototype tasks through each clickable sketch. Record the steps, wrong turns,
and unanswered questions. A static screenshot is not sufficient.
