# Phase 2: make source sync atomic

[Back to the overview](overview.md)

## Goal

Make every successful GitHub sync a complete snapshot of one upstream revision.

## Changes

- Create the candidate directory as a sibling of the active revision inside
  the configured Source storage root. Promotion must stay on one filesystem.
- Reject truncated trees and incomplete downloads.
- Validate the candidate before an atomic rename. Do not fall back to a
  cross-device copy when promotion returns `EXDEV`.
- Preserve the previous valid revision when the new sync fails.
- Add regression tests for deletion, rename, truncation, and download failure.

## Data structures

`SourceSyncCandidate` carries the expected file set, downloaded file set,
upstream revision, and validation result.

## Verification

Static checks run the focused GitHub sync tests, server tests, typecheck, and
lint.

Runtime checks sync a fixture repository, delete and rename upstream files,
sync again, and inspect the promoted directory. The old files must be absent.
Inject an incomplete tree and prove that the prior valid snapshot remains.
Place the system temporary directory on a different mount from Source storage
and prove candidate creation and promotion still use the Source-storage
filesystem.
