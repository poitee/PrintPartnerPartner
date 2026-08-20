# Phase 10: prove the real user journey and update documentation

[Back to the overview](overview.md)

## Goal

Prove the supported workflow in the real application and make every public
description match it.

## Changes

- Add one end-to-end test that launches the real web and server applications.
- Drive the accepted workflow with representative source and printer fixtures.
- Add a real slicer round-trip fixture that proves exported 3MF object names map
  back to the intended checkoff units.
- Rewrite the screenshot capture script for current routes and labels.
- Replace stale README and help screenshots.
- Correct OpenAPI and architecture claims that exceed runtime coverage.

## Data structures

`WorkflowFixture` contains a Source revision, a Build, an accepted Plan,
Required units, an emulated Printer, and expected completion state.

## Verification

Static checks run lint, typecheck, the full test suite, the production build,
documentation links, and screenshot-script checks.

Runtime checks launch the supported Docker or local stack and drive the full
journey with `browser:control-in-app-browser`. Export the named-object 3MF,
open it in an installed supported slicer, and send the sliced artifact through
the slicer's normal Printer integration. PrintPartner must observe the
resulting Printer job, inspect the Object names reported by the connection,
propose the intended Required units, and persist the exact `part_id +
unit_index` mapping after confirmation. PrintPartner upload remains an
optional capability-specific path, not a requirement for this round trip.

The fixture includes duplicate basenames from different Sources and multiple
copies of one part. It proves their stable Object names do not silently cross
map. Inspect the generated artifact, observed Printer operation, persisted
mapping, and final completion state. Review every captured screenshot at
desktop and phone widths.
