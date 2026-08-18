# Task 4 report: Accessibility and responsive UI

## Status

Complete. Task 4 was implemented on `cursor/full-codebase-audit-2c41` with
test-first DOM behavior coverage.

## Implemented

- Added a first-focusable skip link targeting `main#main-content`.
- Removed the shell brand from the heading outline and made routed page titles
  the single page-level `h1`.
- Kept Welcome and authentication routes on the same heading contract,
  including setup-complete and password recovery states.
- Added polite live status semantics to lazy page, plan, progress, and 3D
  loading states.
- Added persistent accessible names to Progress and Parts review searches.
- Converted login to a named semantic form with a submit button, so Enter uses
  the normal form submission path.
- Replaced Welcome's document navigation with React Router SPA navigation.
- Added phone-width plan cards with direct selection and the complete plan
  action menu while preserving the desktop table.
- Added alert semantics to audited initial Plans and Progress error states.
- Kept printable Progress headings subordinate to the routed page heading.
- Added a keyboard-focusable 3D preview with arrow-key rotation, keyboard zoom,
  visible operating instructions, and the existing measurement text
  alternative.
- Added the smallest compatible DOM test harness:
  `@testing-library/react` and `jsdom`, with Vitest TSX discovery.

## TDD evidence

The focused command initially failed all 17 new behavior checks for the
intended missing semantics and interactions:

```text
npm run test -w @print-partner/web -- accessibility Login Welcome Plans
Test Files 10 failed | 1 passed
Tests 17 failed | 3 passed
```

After implementation and test-fixture isolation:

```text
Test Files 11 passed (11)
Tests 20 passed (20)
```

## Verification

- Focused accessibility/Login/Welcome/Plans tests: 20 passed.
- Full web tests: 71 files, 339 tests passed.
- Web typecheck: passed.
- Workspace ESLint (`--quiet`): passed with zero errors.
- Production web build: passed.
- `git diff --check`: passed.
- Self-review against the Task 4 brief: no unresolved Task 4 findings.

## Commits

- `87ab264` — focused Task 4 behavior tests and DOM harness
- `5a05d7b` — loading-state 3D test contract correction
- `4cd8f7b` — accessibility and responsive implementation
- `2053f2e` — isolated multi-render DOM fixtures
- `e8a0ee3` — hidden printable heading test correction

## Concerns

- The successful production build retains existing non-blocking warnings about
  Vite's future native config loader (`__dirname`) and chunks over 500 kB.
  Neither warning was introduced by Task 4.
