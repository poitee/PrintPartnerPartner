# Cleanup verification

This record covers the August 20, 2026 safe cleanup and dependency-refresh wave. It is a command-and-result summary, not a replacement for CI logs.

## Final gates

Run from `web/` unless noted otherwise:

| Gate | Command | Final result |
|---|---|---|
| Reproducible install | `npm ci` | Passed; 702 packages installed and 0 vulnerabilities reported |
| Full quality | `npm run quality` | Passed after the final dependency update |
| Workspace tests | Included in `npm run quality` | Contracts 13, domain 127, web 369, server 784; 1,293 passed and 2 server tests skipped |
| Workflow smoke | Included in `npm run quality` | 4 passed |
| Browser fixtures | Included in `npm run quality` | Skip-link and dark Checkoff sheet checks passed |
| Production builds | Included in `npm run quality` | Contracts, domain, server, and web builds passed |
| Dependency audit | `npm audit --json` | 0 findings at every severity |
| Cleanup inventory | `npm run audit:cleanup` | 1,202 files checked; 0 missing local inline Markdown file targets; 5 zero-inbound candidates retained for manual decisions |
| Legacy settings compatibility | `npm run test --workspace @print-partner/server -- --run src/assistant/resolve-assistant.test.ts` | 11 passed, including a persisted SearXNG setting overriding a conflicting environment provider |
| Compose | `docker compose ... config -q` from the repository root | Base, SaaS, and base plus `pp-compose.yml` overlay passed |
| Manifest validation | `/tmp/printpartner-manifest-venv/bin/python -m unittest discover -s manifests/tests -v` | 9 passed |
| Release command | `npm run test:release` | Passed; preparation, dry-run, tag peeling, and identity rendering covered |
| Notice copies | `cmp THIRD_PARTY_NOTICES.md web/apps/server/src/data/legal/THIRD_PARTY_NOTICES.md` | Identical |
| Diff whitespace | `git diff --check` | Passed |

The cleanup inventory checks inline Markdown links whose targets are local files. It does not validate reference-style links, heading fragments, or external URLs.

## Review loop

CodeRabbit first reviewed the uncommitted tracked diff three times. The first
pass reported four minor findings. Three were valid: the backup route test
needed a non-canonical fixture, persisted SearXNG settings needed an explicit
fallback, and generated notice URLs needed normalization. The missing-script
finding was false because the reviewer did not receive untracked new files.
The second pass found two copies of the same remaining notice-URL issue. The
third pass reported zero findings for that tracked scope.

The new files were then exposed through reversible intent-to-add markers, and
CodeRabbit reviewed the complete working tree in five passes. Every reported
item was checked before editing. The review found one audit resolver omission,
one missing persisted-settings fixture, and planning gaps around revision and
Object identity, concurrency, source validation, path safety, provider failure
handling, and storage lifecycle. Those points are now explicit in the phase
plans. The Plater SHA finding was false; `git ls-remote` confirmed the full SHA
at `refs/heads/master`. A suggested SearXNG database migration was replaced by
the existing idempotent configuration-boundary normalizer because the stored
integration configuration is schemaless JSON; the persisted-record regression
test proves the old value resolves to DuckDuckGo even against a conflicting
environment provider. Review intent markers were removed after every pass, and
the final six plan-only hardening suggestions were incorporated before the
last documentation validation.

## Run incidents

- Knip was tried once in automatic fix mode. It removed required namespace schema and private entrypoint exports, causing 121 lint errors. Those mechanical edits were rolled back before the cleanup continued. Knip is now report-only in the cleanup manifest.
- The first final `npm ci` attempt stopped with `ENOSPC`. The repository used less than 500 MB; npm's download cache used about 16 GB. Only that reinstallable cache was cleared. A later clean install and the full quality gate passed.
- Regenerating the npm lockfile initially nested Fastify below the server while its plugins remained hoisted. Plugin type augmentation then failed. Declaring the same Fastify version in the workspace tool package restored one shared type identity; a later clean install and full quality gate passed.

These incidents are not independently reproducible final-state failures. They are retained to explain the guardrails and package layout in the resulting diff.

## Dependency boundary

Compatible direct updates were applied. Node 26 types, TypeScript 7, `better-sqlite3` 13 and its type package, Chokidar 5, and jsdom 30 remain separate compatibility projects.

## Trail ordering

`decisions.tsv` is append-only. Some earlier planning decisions were recorded after later-timestamped discussion rows. Read file order as the record of entry and use `ts` as the stated decision time; do not sort the file and infer an execution sequence.
