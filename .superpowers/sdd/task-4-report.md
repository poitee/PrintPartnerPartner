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

## Review remediation follow-up

### Status

Complete. Every Critical, Important, and Minor item from the Task 4 review was
addressed.

### Changes

- Replaced the conflicting skip-link utility combination with a dedicated
  production `.skip-link` rule that is clipped at rest and visibly restored on
  focus.
- Added a real Chromium computed-style regression check. It verifies both the
  hidden resting state and the visible, fixed, in-viewport focused state.
- Changed `CardTitle` to default to `h2`, added explicit `level` selection, and
  added Radix `Slot`-based `asChild` composition. Authentication and error
  titles now reuse `CardTitle` styling without copied classes.
- Kept Settings card titles at `h3` under their `h2` section headings and
  corrected Parts section headings to `h2`.
- Corrected Progress print-sheet levels to page `h1`, sheet `h2`, repository
  `h3`, and folder `h4`.
- Rendered only one Plans representation at a time using `useMediaQuery`, with
  the shared accessible label `Plans` for both the mobile list and desktop
  table.
- Replaced the synthetic login form submission test with a `user-event` test
  that presses Enter in the password field.
- Replaced the 3D no-op keyboard assertion with tests that drive the mounted
  component's real Three.js camera. Keyboard zoom now clamps to the configured
  `OrbitControls` minimum and maximum distances.
- Shortened the 3D instructions and kept them scoped to the interactive mesh
  stage.
- Made new loading regions atomic while retaining polite status announcements,
  and removed the page loader's redundant overriding label.
- Replaced unresolved promise mocks and truthiness-only assertions with finite
  mocks and concrete semantic assertions.

### TDD evidence

The review regression suite was committed before production changes. Its first
run failed for the intended missing behavior:

```text
Test Files 6 failed | 1 passed
Tests 9 failed | 8 passed
```

The first real-browser run also failed because the unfocused fixture link had
`width: auto` instead of the required clipped `1px` state.

After implementation:

```text
Focused Task 4 suite: 11 files, 23 tests passed
Chromium skip-link computed-style regression: passed
```

### Verification

- Full web tests: 72 files, 345 tests passed.
- Web typecheck: passed.
- Workspace ESLint (`--quiet`): passed with zero errors.
- Production web build: passed.
- Chromium skip-link CSS regression: passed.
- `git diff --check`: passed throughout each commit.

### Review-fix commits

- `2010e91` — regression tests and real browser harness
- `dcaaa42` — accessibility and responsive review fixes
- `4c8cefb` — explicit assertions and finite test mocks
- `7fe9f97` — semantic heading ref typing
- `12fe7b5`, `ec1c0fd` — browser-test lint corrections

### Follow-up concerns

- The browser test uses `PLAYWRIGHT_CHROMIUM_EXECUTABLE` when set and otherwise
  targets the Cursor Cloud Chrome path (`/usr/local/bin/google-chrome`).
- CodeRabbit CLI review could not run because agent authentication is not
  configured (`status: not_authenticated`). Deterministic tests, typecheck,
  lint, build, and direct diff inspection found no unresolved Task 4 issue.
- The existing Vite native-loader and large-chunk warnings remain unchanged.
