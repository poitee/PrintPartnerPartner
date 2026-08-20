# Phase 11: state the supported platform boundary

[Back to the overview](overview.md)

## Goal

Make startup behavior, documentation, and release notes agree about which
deployment modes PrintPartner supports.

## Changes

- Name SQLite and local storage as the supported self-hosted mode unless Phase
  0 chooses and funds a SaaS program.
- Put experimental backends behind explicit configuration and warnings.
- Remove unimplemented BullMQ and Redis claims.
- Document restart behavior, local artifact assumptions, and tenant limits.
- Create a separate architecture plan if SaaS becomes a committed goal.

## Data structures

`DeploymentCapability` records the selected database, artifact store, job
runner, tenant mode, and support status.

## Verification

Static checks compare configuration flags, startup messages, architecture
documentation, and release notes.

Runtime checks start and restart each documented mode. The supported SQLite and
local-storage mode must pass the full smoke workflow, document which jobs and
artifacts survive restart, and preserve that documented state. Each
experimental mode must identify itself and reconcile its expected state after
restart. When a required capability is absent, startup or the affected
operation must fail closed without a partially written revision, job, or
artifact record.
