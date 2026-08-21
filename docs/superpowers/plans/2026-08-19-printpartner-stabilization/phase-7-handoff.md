# Phase 7 handoff

Use this file to resume the PrintPartner stabilization work in a new Codex session.

## Current state

- Repository: `/Users/poitee/PrintPartner`
- Branch: `main`
- Resume commit: `08b6799 feat: cut over plan edits to drafts`
- Remote status: local commits only. Nothing from this work was pushed.
- Worktree at handoff: clean before this handoff file was added.
- Independent review: clean.

The accepted Plan draft cutover is complete. Browser planning changes now persist as saved drafts. Rebuild and draft edits do not change the accepted Plan or Checkoff. Explicit Apply publishes the accepted Plan revision and Required-unit mapping in one transaction.

The cutover also added exact abandon-then-rebase recovery, atomic accepted-basis printed-count import, and one-batch spreadsheet planning edits. It removed the legacy recompute job, the direct apply-manifest command, and direct inclusion or quantity writes through Part PATCH.

## Verified behavior

The final gate at `08b6799` passed:

- release checks: 8
- contracts: 40 tests
- domain: 76 tests
- web: 434 tests
- server: 1,346 passed and 1 skipped
- workflow smoke: 9 tests
- typecheck, lint, production builds, caller inventory, and diff checks
- live browser flow through Rebuild, hard refresh, and explicit Apply

The live browser proof created one proposed Part while the accepted Plan stayed empty. The saved draft survived a hard refresh. Apply removed the draft and published Plan version 1 with one Required unit.

Review evidence is stored outside the repository at `/tmp/printpartner-phase7-plan-draft-cutover-final-review.md`. The durable architecture and decision record are:

- `CONTEXT.md`
- `docs/superpowers/plans/2026-08-19-printpartner-stabilization/phase-7-plan-revision-architecture.md`
- `docs/superpowers/plans/2026-08-19-printpartner-stabilization/phase-7-workflow-model.md`
- `docs/superpowers/plans/2026-08-19-printpartner-stabilization/cleanup-manifest.md`
- `docs/superpowers/plans/2026-08-19-printpartner-stabilization/decisions.tsv`

## Next unit

Phase 7 caller migrations are complete. Compatibility `parts` and `print_progress`
tables remain as projections. Every production command that creates or changes
accepted Plan requirements now goes through `applyPlanChanges`.

Landed after `08b6799`:

- live filament and Spoolman assignment through `assignAcceptedFilament`
- Progress and assembly writes through accepted token commands
- Part media on the accepted operational snapshot
- duplicate and kit import publish through Apply instead of inserting working Parts

Keep printer queue, printer link, Plan binding, and print-job token migration in
Phase 9. Removing the compatibility tables is a later migration after those
readers have a replacement.

The Phase 7 exit assertion is:

> No production command can change accepted Plan requirements or the Required-unit set except `applyPlanChanges`.

The production inventory in `plan-draft-cutover-inventory.test.ts` pins that
assertion. Phase 8 site structure is in progress on `feat/phase8-site-structure`.
The first route unit landed locally: Builds is home, global nav is Builds /
Production / Printers / Settings, and Build destinations are Sources, Plan,
Checkoff, and Production. Parts and Export remain as page owners behind those
routes until their callers migrate. Resume there rather than redoing Phase 7.

The second route unit assigned canonical URLs: Build Sources is `/sources`,
Plan is `/plan` (the former Parts page), and `/parts` redirects to `/plan`.
The global source registry stays at `/library`. Next: migrate remaining Parts
copy into Plan, then split Build Production from global Production.

## Resume procedure

1. Open `/Users/poitee/PrintPartner`.
2. Run `git status --short` and `git log -1 --oneline`.
3. Confirm that `08b6799` is present in the current history.
4. Read this file, `CONTEXT.md`, `cleanup-manifest.md`, and the final Phase 7 architecture section.
5. Run the existing production inventory test before changing code:

   ```bash
   cd web
   npm test -w @print-partner/server -- --run src/services/plan-draft-cutover-inventory.test.ts
   ```

6. Trace the remaining compatibility callers with `rg` before selecting the next unit.
7. Capture a focused failing test before production edits.
8. Run the relevant focused tests after each unit. Finish with full tests, typecheck, lint, builds, a real browser flow when UI changes, and an independent review.
9. Commit locally. Do not push unless the user gives explicit permission.

## Prompt for another Codex session

Copy this prompt into a new Codex session:

```text
Continue the PrintPartner stabilization work in /Users/poitee/PrintPartner.

Read docs/superpowers/plans/2026-08-19-printpartner-stabilization/phase-7-handoff.md first. Verify the live git state against resume commit 08b6799. Then read CONTEXT.md, the cleanup manifest, and the final Phase 7 architecture section.

Work autonomously and test first. Preserve the accepted Plan draft boundary. Select the smallest coherent next caller migration that advances the Phase 7 exit assertion. Migrate its callers and delete its legacy API in the same wave. Do not fold Phase 9 printer queue/link storage into Phase 7. Run focused and full verification, use the real browser for UI work, obtain an independent clean review, commit locally, and never push.

Report any mismatch between the handoff and the live repository before editing.
```

## Known older debt

These items predate the draft cutover and were not widened into `08b6799`:

- `web/apps/server/src/db/repository.ts` has an existing `no-explicit-any` suppression in persistence insertion plumbing.
- `web/apps/web/src/lib/partsManifest.ts` has a manual keep-in-sync constraint that should eventually become a shared type or executable check.
- The documentation audit reports 19 old broken inline targets in historical 3MF and plater research files.
