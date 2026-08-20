# Phase 4 release identity architecture

## Decision

`web/package.json` is the authoritative application version. A release binds
that version to the peeled commit behind an annotated Git tag, the OCI index
digest, and the GitHub Release through one deterministic identity document.

The next recovery release is `3.2.0`. The existing `v3.1.0` tag and image are
historical failed-publication artifacts on disconnected history. They will not
be moved, deleted, recreated, or presented as a supported release.

## Maintainer interface

One command owns release preparation and validation:

```bash
node scripts/release.mjs prepare 3.2.0 --dry-run
node scripts/release.mjs prepare 3.2.0
node scripts/release.mjs check
```

`prepare --dry-run` computes the exact changes without writing files or
changing Git or remote state. `prepare` changes only explicit current-version
sinks. `check` is always read-only.

CI uses the same command with stricter boundary inputs:

```bash
node scripts/release.mjs check --tag v3.2.0 --commit <peeled-commit>
node scripts/release.mjs render-asset \
  --tag v3.2.0 \
  --commit <peeled-commit> \
  --digest sha256:<oci-index-digest> \
  --output release-identity.json
```

The release command validates SemVer, tags, full commit SHAs, and OCI digests
at its CLI boundary. Internal functions operate on validated values.

## Identity shape

The CI-generated `release-identity.json` contains:

```json
{
  "schema_version": 1,
  "version": "3.2.0",
  "runtime_version": "3.2.0-web",
  "tag": "v3.2.0",
  "commit": "<40-character peeled commit>",
  "image": {
    "repository": "ghcr.io/poitee/print-partner",
    "digest": "sha256:<64 hexadecimal characters>",
    "expected_aliases": ["3.2.0"],
    "mutable_aliases": ["latest"]
  },
  "supported_deployment_modes": ["self-host"],
  "github_release_url": "https://github.com/poitee/PrintPartnerPartner/releases/tag/v3.2.0"
}
```

The image digest cannot be baked into the image it identifies. Runtime health
therefore reports the build identity available inside the image: version,
peeled commit, tag, build date, deployment mode, and release URL. OCI labels
bind the image config to the same version, commit, tag, source URL, and build
date. The release asset adds the digest after the registry returns it.

Local source builds are explicitly development identities. They use the
package version and report unknown commit/tag values unless build metadata is
injected. No checked-in identity file claims to know the commit that contains
it.

## Version sinks

Preparation updates only these explicit current-version fields:

- `web/package.json` and the root entries in `web/package-lock.json`
- the Dockerfile application-version build argument
- the default image tag in `docker-compose.yml`
- the current release examples in `README.md`, `web/DEPLOY.md`, and
  `OPERATIONS.md`
- the current `[Unreleased]` changelog section and comparison links

Private workspace package versions remain independent at `0.1.0`. Historical
changelog entries are not bulk-rewritten.

## Publication order

1. Checkout the tag with full history and serialize runs by tag.
2. Peel the annotated tag with `git rev-parse "refs/tags/$tag^{}"`; compare it
   with the checked-out commit. Never assume the tag event SHA is the commit.
3. Run the read-only release check before publishing anything.
4. Build the multi-platform image with runtime build metadata and OCI labels.
   Publish a commit-scoped candidate tag only if absent. If it already exists,
   reuse it only when its digest and identity metadata match; otherwise fail.
5. Pin every later operation to the returned OCI index digest and verify the
   required metadata on every platform manifest.
6. Generate the deterministic identity asset. Create the GitHub Release, or
   accept an existing release only when its tag target and identity asset
   match.
7. Create the version image alias only when absent; accept it only at the same
   digest; never overwrite a conflicting version alias.
8. Verify the public release, asset, and version alias.
9. Move `latest` last as a convenience alias. It is not part of immutable
   release identity.

GitHub Releases and GHCR are not transactional. This order makes a public
release with a temporarily missing convenience alias the recoverable failure
case, instead of repeating the unsupported-version-image-without-release split
from `v3.1.0`.

The workflow does not change GHCR visibility. Package visibility is a one-time
repository setting, and the release preflight only verifies accessibility.

## Modules

- `scripts/release.mjs` is the deep maintainer and CI interface. It owns
  parsing, version-sink planning, local checks, annotated-tag validation, and
  deterministic asset rendering.
- `.github/workflows/release.yml` owns remote orchestration and keeps identity
  policy in calls to the release command.
- `web/apps/server/src/lib/version.ts` resolves runtime build identity from
  validated image environment variables and the package-version fallback. It
  never shells out to Git.
- `web/packages/contracts` exposes the health payload shape used by the web
  client.

## Verification

Focused tests cover malformed boundary inputs, version drift, dry-run zero
writes, preparation in a fixture tree, annotated-tag peeling, and deterministic
asset output. Workflow smoke tests cover removal of the visibility mutation,
full-history checkout, tag peeling, candidate-before-release ordering,
create-or-verify version aliases, final `latest` promotion, and identity asset
attachment.

The real Phase 4 proof remains gated on approval to create and push `v3.2.0`.
Until then, local preparation, workflow validation, image build inspection,
and the full repository quality suite establish that the release path is
ready without mutating shared history or remote release state.

## Tradeoffs

- A small custom release command replaces a short but unsafe shell script.
- Existing top-level health fields remain for compatibility, but all derive
  from one runtime identity resolver.
- `latest` remains convenient for operators but is explicitly mutable and
  non-authoritative.
- Remote publication is convergent rather than transactional; retries reject
  conflicting artifacts instead of overwriting them.

## Rejected alternatives

- A checked-in generated identity file cannot contain the SHA of the commit
  that contains that file.
- Rewriting `v3.1.0` would alter shared history and would not repair the image
  and GitHub Release split safely.
- Publishing stable image aliases before the GitHub Release repeats the
  observed failure mode.
- Updating GHCR visibility during every release adds a brittle unrelated
  mutation between otherwise valid publication steps.
