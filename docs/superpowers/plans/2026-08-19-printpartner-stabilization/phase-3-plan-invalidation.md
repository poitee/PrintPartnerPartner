# Phase 3: invalidate plans after source changes

[Back to the overview](overview.md)

## Goal

Tell users when a plan no longer represents its source revisions.

## Changes

- Compare a plan's recorded inputs with current source revisions.
- Mark affected plans stale after atomic promotion.
- Persist global and source-specific STL naming changes through tested routes.
- Mark affected plans stale when their effective STL naming rules change.
- Expose the reason through the existing plan response.
- Add repository and route tests for affected and unaffected plans.

## Data structures

`PlanFreshness` is either current or stale. Stale state carries a reason
discriminator (`source_revision_changed` or `naming_rules_changed`), the
changed Source revision inputs, and the effective naming-rule revision or
digest. Global and Source-specific naming changes populate the same explicit
shape and remain visible in the existing Plan response.

## Verification

Static checks run focused repository and route tests, server typecheck, and
lint.

Runtime checks sync one source used by two plans and one unrelated source. Only
the dependent plans become stale. Change one source naming rule and confirm
that its dependent plans also become stale with the naming-rule reason and
digest. Recomputing produces a draft while the accepted Plan remains stale and
pinned to its prior inputs. `Apply plan changes` atomically persists the new
Plan revision, its Source revision inputs, naming-rule digest, and inferred
values. Only a successful apply clears stale state; a failed apply leaves the
accepted Plan and its freshness unchanged.
