# Phase 4: repair release identity

[Back to the overview](overview.md)

## Status

Local implementation is complete and prepared for `3.2.0`. Publication proof
is still pending because creating and pushing the tag changes shared remote
state and requires explicit approval.

## Goal

Make a tag, image, package version, and GitHub release identify the same commit.

## Changes

- [x] Preserve the diverged `v3.1.0` tag as a failed publication on
  disconnected history.
- [x] Prepare `3.2.0` as the next release version.
- [x] Make one release command update and validate every current version sink.
- [x] Remove the failing GHCR visibility operation.
- [x] Add deterministic dry-run, tag-peeling, OCI metadata, identity-asset,
  retry-conflict, and publication-order checks.
- [ ] Create and push the approved annotated `v3.2.0` tag.
- [ ] Verify the public image digest, GitHub Release asset, version alias, and
  runtime health against the tagged commit.

Do not rewrite or delete shared Git history without explicit approval.

## Data structures

`ReleaseIdentity` contains a version, git commit, image digest, supported
deployment mode, and GitHub release URL.

See [the accepted architecture](phase-4-release-identity-architecture.md) for
the command contract, version sinks, runtime identity, and convergent
publication order.

## Verification

Static checks validate version consistency, workflow syntax, shell scripts,
Docker Compose configuration, and image metadata.

Local checks now prove a non-mutating preparation preview, focused release and
runtime tests, workflow structure, Compose rendering, Dockerfile validation,
and the full repository quality suite. Publishing requires explicit approval.
This phase remains open until an approved real release proves that the tag,
image digest, GitHub Release, and running image refer to that commit.
