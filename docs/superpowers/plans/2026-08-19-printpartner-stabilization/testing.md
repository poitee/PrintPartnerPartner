# Stabilization verification

[Back to the overview](overview.md)

## Per-phase checks

Every implementation phase runs focused tests first, then these repository
checks from `web`:

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

Docker-related phases also build the supported image and validate the Compose
configuration. Release phases inspect the produced multi-architecture manifest
and image labels.

## Runtime checks

Use `browser:control-in-app-browser` against the real web and server processes.
Component fixtures do not satisfy a runtime check. Each affected phase records:

- the starting state;
- the user action;
- the visible result;
- the server-side state or produced artifact; and
- the failure path exercised.

## Program check

The final run starts from a clean self-hosted installation. It adds and syncs a
source, creates the accepted planning object, resolves required parts, prepares
only the remaining required units, assigns those units to selected printers,
arranges them against each printer's build volume, prepares the required
plates, sends the work, and records completion. The run traces each exported
object back to one required unit. It then changes the upstream source and
proves that the old plan becomes stale.

The run fails if the user must reload to reconcile state, if two equal labels
perform different operations, if deleted source files remain, or if the public
documentation shows another workflow.

After explicit approval to publish, the program check reads the release tag,
the image digest and labels, and the GitHub release. The stabilization program
remains open until all three identify the same commit.
