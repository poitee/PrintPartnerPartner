# Phase 4: repair release identity

[Back to the overview](overview.md)

## Goal

Make a tag, image, package version, and GitHub release identify the same commit.

## Changes

- Document how the diverged `v3.1.0` history will be treated.
- Choose the next version after the product decision.
- Make one release command update every version location.
- Remove or correct the failing GHCR visibility operation.
- Add a dry-run check for tag, manifest, image, and release metadata.

Do not rewrite or delete shared Git history without explicit approval.

## Data structures

`ReleaseIdentity` contains a version, git commit, image digest, supported
deployment mode, and GitHub release URL.

## Verification

Static checks validate version consistency, workflow syntax, shell scripts,
Docker Compose configuration, and image metadata.

Runtime checks first run the release process in dry-run mode from a known
commit. Publishing requires explicit approval. This phase remains open until an
approved real release proves that the tag, image digest, and GitHub release all
refer to that commit.
