# Source revision and monitoring research

Research date: 2026-08-19

## Recommendation

PrintPartner should track a reusable Library Source separately from the
revisions fetched from that source. A Build attaches the Library Source and
pins one immutable Source revision. Its file selections also belong to that
Build attachment, not to the shared Library Source.

Monitoring should report that a newer revision exists. It must not change the
revision used by a Build, recompute an accepted Plan, or alter Checkoff. The
user reviews the change summary in a Plan draft and applies it when ready.

Ship the first complete integration for GitHub. GitHub publishes the commit,
tree, archive, webhook, authentication, and rate-limit contracts needed to do
this safely. Treat Printables, MakerWorld, and Thangs as manual-import
providers until each provider publishes a supported read API or grants
PrintPartner access to one. Their websites expose useful information to a
person, but private website calls and parsed HTML are not stable product APIs.

This still gives marketplace Sources revision history. Each archive the user
imports becomes an immutable Source revision. PrintPartner can compare that
revision with the previous import and report added, removed, renamed, and
changed parts. What it cannot promise is automatic upstream detection for
those providers today.

## Terms used here

- A **Library Source** is one reusable upstream repository, marketplace model,
  local folder, or uploaded collection.
- A **Source observation** is the result of checking upstream. It can report no
  change, a candidate revision, an authentication problem, a missing Source,
  or a temporary failure. An observation is not a revision.
- A **Source revision** is an immutable, validated snapshot with an identity
  and file manifest.
- A **Build Source** attaches a Library Source to one Build. It pins one Source
  revision and owns that Build's file-selection rules.
- A **change summary** compares two complete Source revision manifests.

## Provider capability matrix

"Not published" means this research found no first-party developer contract
for the capability. It does not mean an endpoint could not be observed in a
browser. PrintPartner should not treat an observed private endpoint as
supported.

| Provider | Public supported API | Webhook or feed | Revision identity and timestamps | File metadata and download | Authentication and limits | Recommended PrintPartner mode |
| --- | --- | --- | --- | --- | --- | --- |
| GitHub | Yes. The REST API resolves a branch, tag, or SHA to a commit and reads Git trees. | Yes. A repository or GitHub App webhook can subscribe to `push`; the payload includes the before and after commit SHAs. | Commit SHA is the revision identity. Commit metadata supplies author and committer dates. | Git trees expose paths, blob SHAs, and sizes. Repository ZIP and tar archives can be downloaded for a ref. | Public data can be read without authentication. Private data needs Contents read access. REST limits are 60 requests per hour without authentication and 5,000 per hour for normal authenticated user requests. | Native polling now. Add an optional webhook hint where the deployment has a public HTTPS endpoint. |
| Printables | No published public developer API found. | No published webhook or feed contract found. The native community feed reports new work from followed designers, but it is a user-facing feature. | Public, Printables-generated model PDFs can contain model and individual-file update dates, but no documented immutable model revision identifier was found. | The supported product path is the Printables website embedded in PrusaSlicer, where a user can browse and download model or project files. No documented bulk file API was found. | The Printables view supports registered and unregistered browsing. No public API authentication or rate-limit contract was found. | Store the model URL, open it for the user, and import the user's downloaded archive as a new revision. Do not call the private GraphQL service or scrape pages. |
| MakerWorld | No published public developer API found. | No published model-update webhook or feed contract found. | Public model pages use a numeric model ID and show release information, but no documented immutable revision ID or machine-readable change timestamp was found. | Public pages expose print profiles and local Bambu Studio handoff. No supported general file-list or download API was found. | No public API authentication or rate-limit contract was found. | Store the model URL, open it for the user, and import the user's downloaded files as a new revision. Do not depend on website-internal calls. |
| Thangs | No published public read API for model-library integration was found. | Thangs can notify a signed-in user and send email when a followed creator uploads a new model. It also describes new-version notifications inside its own Workspace. No external webhook or feed contract was found. | Public model pages have model IDs and relative age, but no documented immutable revision ID for a downloaded model was found. | Files are downloaded through the product UI. Thangs says purchased models can be downloaded again and receive future updates. | No public read-API rate limit was found. Thangs prohibits unauthorized scraping and automated scraping or bulk downloading. | Manual import only. The user may use native Thangs notifications as a prompt to import again. PrintPartner must not scrape Thangs. |
| Local folder or uploaded archive | Local filesystem or user upload, not a remote API. | A local filesystem watcher is possible for an explicitly linked folder. Uploaded archives have no upstream signal. | Use a PrintPartner snapshot ID plus a SHA-256 manifest digest. Record file modification times as metadata, not identity. | PrintPartner reads files the user selected or uploaded. | No remote authentication or rate limit. | Create an immutable revision on each explicit snapshot. A local watcher may report that the folder changed, but should not promote a revision without validation. |

GitHub sources: [commit API](https://docs.github.com/en/rest/commits/commits),
[Git tree API and recursive-tree limits](https://docs.github.com/en/rest/git/trees),
[repository archives](https://docs.github.com/en/rest/repos/contents),
[push webhook payload](https://docs.github.com/en/webhooks/webhook-events-and-payloads#push),
[repository webhook permissions](https://docs.github.com/en/rest/repos/webhooks),
[REST rate limits](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api),
and [conditional-request guidance](https://docs.github.com/en/rest/using-the-rest-api/best-practices-for-using-the-rest-api#use-conditional-requests-if-appropriate).

Printables sources: [official Printables in PrusaSlicer documentation](https://help.prusa3d.com/article/printables-in-prusaslicer_822448),
[official Community Feed announcement](https://blog.prusa3d.com/new-on-printables-com-community-feed-improved-search-new-rewards-and-more_69067/),
and a [Printables-generated model PDF showing model and file update dates](https://media.printables.com/media/prints/159199/pdfs/159199-stratocaster-pickup-pickguard-template-97609139-7f64-4957-9ab4-08e3d54f7c09.pdf).

MakerWorld source: [public MakerWorld model page](https://makerworld.com/en/models/21901-clippy).

Thangs sources: [official social-notification documentation](https://thangs.com/resources/blog/how-to-use-social-features-on-thangs),
[official Help Center](https://thangs.com/resources/help-center),
[terms prohibiting unauthorized scraping](https://thangs.com/resources/legal/terms-and-conditions),
and [content policy prohibiting automated scraping and bulk downloads](https://thangs.com/resources/legal/content-policy).

## Supported integration versus page observation

These are different product promises and should stay visibly different:

| Method | What PrintPartner can promise | Use |
| --- | --- | --- |
| Documented API | Parse a versioned response, honor published authentication and limits, test the contract, and classify failures. | Supported provider adapter. |
| Verified webhook | Treat an authenticated event as a prompt to check the provider API. GitHub recommends validating `X-Hub-Signature-256` with the webhook secret. | Optional low-latency hint, never the only source of truth. |
| Public page polling | A page may change because of comments, counters, experiments, localization, or HTML changes. An `ETag` would identify the page response, not a file revision. | Do not ship as revision monitoring. |
| Scraping or private website API | The schema, authentication flow, and limits are not promised to third parties. Thangs also prohibits this behavior. | Do not ship. |
| Manual import | PrintPartner controls the uploaded bytes and can hash, validate, store, and compare them. It cannot know that upstream changed before the user imports again. | Supported marketplace and archive mode. |

GitHub recommends webhooks instead of API polling when possible and conditional
requests when polling. An authenticated conditional request that receives
`304 Not Modified` does not count against the primary REST limit. GitHub also
says failed webhook deliveries are not automatically retried, so periodic
polling remains the repair path. See [REST API best practices](https://docs.github.com/en/rest/using-the-rest-api/best-practices-for-using-the-rest-api)
and [failed webhook delivery behavior](https://docs.github.com/en/webhooks/using-webhooks/handling-failed-webhook-deliveries).

A self-hosted PrintPartner running only on a private LAN may not have a public
HTTPS webhook receiver. Polling therefore remains the baseline even after a
GitHub webhook option exists.

## Discovery subscriptions

Discovery is a separate concern from revision monitoring:

- **Discovery** asks whether a new upstream project exists that is not in the
  Source Library.
- **Revision monitoring** asks whether an already tracked Library Source has a
  newer revision.

In this section, "project" means a source repository or marketplace model. It
does not mean a GitHub Projects planning board.

A discovery result should be a suggestion for review. It must not create a
Library Source, download files, attach anything to a Build, recompute a Plan,
or change Checkoff. Adding an approved suggestion to the Source Library starts
the normal initial-import and revision-monitoring workflow.

### Discovery provider matrix

| Scope | Verified capability | PrintPartner behavior |
| --- | --- | --- |
| GitHub user | List a user's public repositories, sort by creation, and paginate up to 100 per page. [Official endpoint](https://docs.github.com/en/rest/repos/repos#list-repositories-for-a-user) | Poll every 6–24 hours with conditional requests. Suggest newly observed repository IDs. |
| GitHub organization | List organization repositories visible to the credential and sort by creation. [Official endpoint](https://docs.github.com/en/rest/repos/repos#list-organization-repositories) | Poll every 6–24 hours. A GitHub App's `installation_repositories` event may prompt an early reconciliation, but means a repository was added to the installation, not necessarily created. [Official webhook event](https://docs.github.com/en/webhooks/webhook-events-and-payloads#installation_repositories) |
| GitHub repository family or topic | GitHub topics and `user:`, `org:`, and `topic:` search qualifiers can identify candidates. Search returns at most 1,000 results and is limited to 30 requests per minute authenticated or 10 unauthenticated. [Topics](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/classifying-your-repository-with-topics) [Search](https://docs.github.com/en/rest/search/search) | Treat owner/topic rules as advisory and user-approved. GitHub has no verified repository-family contract. Run broad queries daily or weekly, not continuously. |
| GitHub release | Releases and the `release` webhook report activity in an existing repository. [Release API](https://docs.github.com/en/rest/releases/releases) [Release webhook](https://docs.github.com/en/webhooks/webhook-events-and-payloads#release) | Route to revision monitoring for the known Library Source. Do not treat a release as new-Source discovery. |
| Printables creator | The native Community Feed shows new models uploaded by followed designers. [Official announcement](https://blog.prusa3d.com/new-on-printables-com-community-feed-improved-search-new-rewards-and-more_69067/) No external API, webhook, or feed contract was verified. | Open the native feed or creator page; let the user add a URL or downloaded archive. Do not scrape. |
| MakerWorld creator | Public creator pages expose Follow and published-model listings. [Official profile](https://makerworld.com/en/%40MakerWorld) No external API, webhook, feed, or new-model notification contract was verified. | Open the creator page; let the user add a URL or downloaded files. Do not poll page HTML or private website calls. |
| Thangs creator | Native following can notify a user when a designer uploads a model. [Official documentation](https://thangs.com/resources/blog/how-to-use-social-features-on-thangs) No external webhook or feed was verified, and automated scraping is prohibited. [Terms](https://thangs.com/resources/legal/terms-and-conditions) [Content policy](https://thangs.com/resources/legal/content-policy) | Let the user turn a native Thangs notification into a manual Source import. Do not scrape. |

The cadences in this table are PrintPartner product defaults, not provider
promises. Users should be able to slow them down or run an on-demand check.

Persist `DiscoverySubscription` separately from `LibrarySource`. Store its
provider scope, filters, credential reference, schedule, ETag or last complete
boundary, and failure state. Store each unknown match as a `SourceSuggestion`
deduped by provider plus stable provider item ID, with `new`, `added`,
`dismissed`, and `ignored` states. If the item already exists in the Library,
route it to revision monitoring instead. By default, the first successful poll
establishes the baseline without alerting on every existing repository.

Use one credential-aware scheduler for discovery and revision checks. Retain
GitHub ETags; an authenticated conditional request returning `304 Not
Modified` does not count against the primary REST limit. A failed or incomplete
check must not advance the complete baseline. Back off, honor `Retry-After` and
rate-limit reset headers, and warn when Search reports `incomplete_results`.
[GitHub conditional requests](https://docs.github.com/en/rest/using-the-rest-api/best-practices-for-using-the-rest-api#use-conditional-requests-if-appropriate)
[GitHub rate limits](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api)

Notify once per new suggestion or as a digest. A follow subscription expresses
interest; it does not authorize automatic download. The user must review
relevance, access, and licensing before adding the candidate to the Library.

## Current PrintPartner findings

The current code has parts of this system, but the persistence model cannot
represent the accepted workflow yet.

### One mutable Source row holds several jobs

`projects` currently combines the reusable Source identity, tracked Git ref,
active local directory, one `lastCommitSha`, shared import rules, and arbitrary
metadata. There is no Source revision table or revision file manifest.
[Source schema](../../../../web/apps/server/src/db/schema.ts#L10)

`profile_layers` attaches a Build directly to that mutable project ID. It does
not pin a Source revision and has no Build-specific file-selection fields.
Because `importedPaths` lives on `projects`, two Builds that use the same Source
also share its selection rules.
[Build-to-Source relation](../../../../web/apps/server/src/db/schema.ts#L52)
[shared import rules](../../../../web/apps/server/src/db/schema.ts#L20)

This is the seam to fix. Keep the reusable identity in the Library Source and
move pinned revision plus selections to Build Source.

### The update check only compares one GitHub SHA

The checker resolves the tracked branch or tag with GitHub's commit endpoint
and compares the returned SHA with `lastCommitSha`. Every error becomes
`unknown`. It stores only a three-state flag and check time in the Source's
metadata JSON. It does not retain the observed remote SHA, response caching
headers, failure class, retry time, or a file change summary.
[current update check](../../../../web/apps/server/src/services/source-update-check.ts#L11)
[current stored status](../../../../web/apps/server/src/services/source-update-check.ts#L51)

The scheduler checks all Git Sources serially at one global interval, 24 hours
by default. When it sees an update, it can immediately sync it.
[current scheduler](../../../../web/apps/server/src/services/source-watcher.ts#L214)
[current auto-sync branch](../../../../web/apps/server/src/services/source-watcher.ts#L128)

The server enables update auto-sync by default. That conflicts with the
accepted rule that a Library update must not move a Build or its accepted Plan.
[current default](../../../../web/apps/server/src/app.ts#L192)

### Sync does not create an immutable complete revision

The GitHub reader already resolves a ref to a commit SHA and receives GitHub's
`truncated` flag from the recursive tree call.
[tree result](../../../../web/apps/server/src/services/github-sync.ts#L159)

The sync path then discards that flag, limits STL downloads to 500 by default,
and writes the fetched files into the existing directory. It does not remove
files absent from the new tree before storing the new SHA.
[discarded truncation state](../../../../web/apps/server/src/services/github-sync.ts#L239)
[download limit and in-place directory](../../../../web/apps/server/src/services/github-sync.ts#L277)
[mutable Source promotion](../../../../web/apps/server/src/routes/sources.ts#L500)

This matters because GitHub caps a recursive tree response at 100,000 entries
or 7 MB and marks an incomplete response as `truncated`. GitHub instructs
clients to traverse subtrees when that happens.
[GitHub tree limits](https://docs.github.com/en/rest/git/trees#get-a-tree)

Phase 2 already calls for a candidate directory, completeness validation, and
atomic promotion. The revision store proposed below is the durable record that
phase needs.
[Phase 2 plan](phase-2-atomic-source-sync.md)

### Plan freshness is timestamp-based, not revision-based

Build freshness currently compares `configModifiedAt` with
`lastRecomputedAt`. The repository can mark every Build that references a
Source as modified, but Source sync does not call that method. Import-rule
changes do.
[freshness calculation](../../../../web/apps/server/src/db/repository.ts#L1232)
[affected-Build marker](../../../../web/apps/server/src/db/repository.ts#L1255)
[import-rule invalidation](../../../../web/apps/server/src/db/repository.ts#L1924)
[sync marker](../../../../web/apps/server/src/db/repository.ts#L1905)

Phase 1 and Phase 3 correctly call for immutable Source identity and recorded
Plan inputs. They should be expanded to include the reusable Library Source and
Build Source pin.
[Phase 1 plan](phase-1-source-revision-model.md)
[Phase 3 plan](phase-3-plan-invalidation.md)

### Marketplace adapters are placeholders

Printables and MakerWorld currently return `supported: false`; Printables asks
the user to upload a ZIP, while MakerWorld directs the user elsewhere. Thangs
has no adapter.
[current adapter stubs](../../../../web/apps/server/src/services/source-adapters.ts#L1)

That conservative behavior is preferable to depending on undocumented calls.
The target should make manual imports first-class and revision-aware instead
of describing them as a lesser GitHub substitute.

### External notification pieces exist, but there is no alert record

The watcher can send `source.update_available`, `source.updated`, and failure
messages through Discord and PrintPartner webhooks. The outbound webhook code
signs payloads and applies URL checks, but registrations live in a settings
JSON value and delivery is best effort.
[source events](../../../../web/packages/contracts/src/index.ts#L363)
[outbound webhook store](../../../../web/apps/server/src/services/webhook-store.ts#L7)
[Discord source events](../../../../web/apps/server/src/services/discord-notify.ts#L4)

There is no durable in-app Source alert with read, dismissed, superseded, and
resolved states. External delivery should fan out from that durable alert, not
stand in for it.

## Target data model

### `LibrarySource`

Store the reusable identity and monitoring policy:

- `id`, `name`, and `providerKind`;
- normalized provider locator and provider Source ID;
- tracked ref for Git providers;
- credential reference, never the secret itself;
- monitoring mode, interval, next check, and last successful check;
- latest observed upstream key and latest validated revision ID;
- archived state and license or access notes.

Do not store active files or Build selections on this row.

### `SourceObservation`

Record every meaningful check result as a discriminated state:

- `unchanged` with the checked revision key;
- `candidate` with the newly observed revision key;
- `auth_required`;
- `inaccessible` when the provider does not reveal whether the Source is
  missing or merely hidden from the current credential;
- `not_found`;
- `rate_limited` with `retryAt`; or
- `failed` with a transient or permanent classification.

Keep the provider response validator version, `ETag`, `Last-Modified`, request
ID, rate-limit values, and checked time when they exist. Dedupe repeated
unchanged observations according to retention policy rather than writing one
row every poll forever.

### `SourceRevision`

One immutable validated snapshot contains:

- Library Source ID and provider revision key;
- observed, upstream-published, downloaded, and validated times;
- tracked branch or tag and resolved commit when relevant;
- snapshot storage location and archive SHA-256;
- manifest SHA-256, file count, total bytes, and completeness result;
- retrieval method such as `github_api`, `manual_archive`, or `local_snapshot`;
- provider metadata captured at that time, including title and license when
  available.

Use a unique constraint on Library Source plus provider revision key. Manual
imports derive that key from the content-manifest digest plus canonicalized
identity metadata, including title, license, and access state. Retrying truly
identical content and metadata converges on the existing revision. Changed
identity metadata creates a new revision even when the file bytes are equal.

### `SourceRevisionFile`

Store each file's normalized relative path, provider file ID when documented,
size, content SHA-256, provider blob hash when available, media kind, and
upstream modified time when supplied. The manifest is authoritative for a
revision. The working directory is only a cache.

### `SourceChangeSet`

Compare validated manifests inside PrintPartner. Do not depend on GitHub's
compare response as the only diff because GitHub returns at most 300 changed
files for a comparison.
[GitHub comparison limit](https://docs.github.com/en/rest/commits/commits#compare-two-commits)

Classify files as added, removed, modified, renamed, or unchanged. Detect an
exact rename when one removed path and one added path share a content digest.
Keep ambiguous duplicate-digest cases as separate remove and add operations.

The summary should count at least:

- printable files by type;
- documents;
- files selected by at least one Build;
- naming-derived quantity or role changes;
- license, description, or access changes; and
- paths that could not be mapped safely.

### `BuildSource`

Store Build ID, Library Source ID, pinned Source revision ID, layer order or
role, Build-specific selection rules, naming overrides, and the revision that
the accepted Plan consumed. A Build can choose whether to follow a branch or
remain pinned indefinitely, but a newly observed revision never moves this
pointer automatically.

### `SourceAlert`

Store one durable alert detail per Source and candidate identity. It needs a
category, severity, created time, first and latest observation IDs, affected
Build IDs, and change summary ID. Store view state separately in
`SourceAlertScope`, keyed by alert ID plus either one Build ID or the Library
view. Each scope has its own state:

- `unread`;
- `read`;
- `dismissed`;
- `superseded`; or
- `resolved`.

External webhook or Discord delivery records should refer to the shared alert
ID and, when relevant, its scope. Repeated polling must update the existing
alert rather than notify on every check. Reading or dismissing one Build's
scope must not change another Build or the Library view.

## Provider adapter contract

Keep monitoring and snapshot creation separate. This prevents a provider that
can only normalize a URL or accept manual files from pretending it can detect
or download revisions.

```ts
type ProviderResponseMeta = {
  validatorVersion: string;
  checkedAt: string;
  etag?: string;
  lastModified?: string;
  requestId?: string;
  rateLimit?: { remaining: number; resetAt: string };
};

type SourceProbeResult =
  | { kind: "unchanged"; revisionKey: string; response: ProviderResponseMeta }
  | { kind: "candidate"; revisionKey: string; providerData: unknown; response: ProviderResponseMeta }
  | { kind: "auth_required"; response: ProviderResponseMeta }
  | { kind: "inaccessible"; message: string; response: ProviderResponseMeta }
  | { kind: "not_found"; response: ProviderResponseMeta }
  | { kind: "rate_limited"; retryAt: string; response: ProviderResponseMeta }
  | { kind: "failed"; retryable: boolean; message: string; response: ProviderResponseMeta };

type CandidateValidationResult =
  | {
      kind: "valid";
      manifestDigest: string;
      fileCount: number;
      totalBytes: number;
      response: ProviderResponseMeta;
    }
  | {
      kind: "invalid";
      reason:
        | "incomplete_tree"
        | "digest_mismatch"
        | "lfs_object_unavailable"
        | "unsafe_path"
        | "unsupported_content";
      message: string;
      response: ProviderResponseMeta;
    };

type SourceProviderAdapter =
  | {
      mode: "native";
      kind: "github";
      normalizeLocator(input: string): Promise<unknown>;
      probe(source: unknown, previous: unknown): Promise<SourceProbeResult>;
      fetchCandidate(source: unknown, revisionKey: string): Promise<unknown>;
      validateCandidate(candidate: unknown): Promise<CandidateValidationResult>;
    }
  | {
      mode: "manual";
      kind: "printables" | "makerworld" | "thangs" | "archive";
      normalizeLocator(input: string): Promise<unknown>;
      validateUpload(upload: unknown): Promise<unknown>;
    };
```

The real implementation should use branded IDs and validated contract types
instead of `unknown` after each boundary parser. `unknown` is intentional in
this sketch because provider input has not been parsed yet. Add a provider to
the native branch only when its documented contract supports a stable revision
probe and lawful snapshot retrieval.

Persist response metadata on every Source observation. A valid candidate may
create a Source revision. An invalid result creates a failed validation
observation, maps to `candidate_invalid`, preserves its typed reason such as
`lfs_object_unavailable`, and leaves the prior complete revision active.

A GitHub webhook receiver is a separate boundary. It must verify
`X-Hub-Signature-256` over the exact bounded raw request bytes before JSON
parsing, using HMAC-SHA256 and a constant-time comparison. Reject missing or
malformed signatures and oversized bodies. Only then parse the payload, dedupe
`X-GitHub-Delivery`, store the event, and enqueue a normal `probe`. The webhook
payload is a hint. The API probe still confirms the tracked ref before any
candidate download.
[GitHub signature validation](https://docs.github.com/en/webhooks/using-webhooks/validating-webhook-deliveries)
[GitHub webhook best practices](https://docs.github.com/en/webhooks/using-webhooks/best-practices-for-using-webhooks)

## Monitoring and review workflow

1. The scheduler selects due Library Sources by provider and credential. It
   adds jitter so every installation does not check on the hour.
2. A native adapter probes the remote revision. A manual adapter shows its
   last review date and an `Open source page` action instead.
3. An unchanged result records health and schedules the next check.
4. A candidate result creates or updates one `Update available` alert. It does
   not change any Build.
5. For GitHub, PrintPartner downloads the candidate into a new location,
   validates the complete manifest, and creates the immutable Source revision.
   For a marketplace, the user downloads files through the provider and
   imports them; that import creates the candidate revision.
6. PrintPartner compares the new revision with the previous validated revision
   and shows a concise summary, with a file-level view available.
7. Each affected Build still points to its old revision. The Build shows
   `Source update available`, not `Plan changed`.
8. `Review in Plan` creates or updates a Plan draft that proposes the new Build
   Source pin. Unchanged selected files carry forward. Added files start
   unselected unless an explicit selection rule includes them. Removed or
   ambiguously renamed selected files require a decision.
9. Applying the draft creates a Plan revision that records every Source
   revision input. Checkoff carries completion forward only when the durable
   part identity and selected file's content identity still map. A stable
   `part_id` by itself is insufficient after the Source revision or file bytes
   change. Changed or removed units keep their history and appear explicitly in
   review; the update never silently transfers, unchecks, or deletes completed
   work.
10. Dismissing an alert affects only that Build or Library view. It does not
    delete the Source revision. A later upstream revision supersedes the old
    alert.

This distinction matters: a Build pinned to revision A is still reproducible
after the Library fetches revision B. It has an update available, but it is not
incorrect. Only the user's reviewed Plan change moves it to B.

## Alert categories

| Category | Default severity | Meaning and action |
| --- | --- | --- |
| `revision_available` | Review | A validated newer revision exists. Open its summary. |
| `selected_part_modified` | Review | Bytes changed for a file selected by an affected Build. Review before moving the Build pin. |
| `selected_part_removed` | High | A selected file disappeared and no exact rename was found. Resolve the requirement in the Plan draft. |
| `part_added` | Info | A printable file was added. It remains unselected unless a Build rule includes it. |
| `part_renamed` | Review | Content is identical at a new path. Show the proposed mapping. |
| `naming_inference_changed` | Review | A path or filename change alters inferred quantity or filament role. |
| `documentation_changed` | Info | A README, Markdown file, or PDF changed. Show whether any Build uses it as guidance. |
| `license_or_access_changed` | High | Captured license or availability metadata changed. Do not assume prior download rights still apply. |
| `source_missing` | High | The provider unambiguously reports that the Source was removed. Preserve the last valid revision. |
| `authentication_required` | High | The credential is absent, expired, or lacks access. Ask the user to reconnect. |
| `source_inaccessible` | High | The provider hides whether the Source is missing or private. Verify credentials and access without discarding the last valid revision. |
| `monitor_delayed` | Warning | Checks have failed past a threshold. Show the last successful check and next retry. |
| `candidate_invalid` | High | Download or validation was incomplete. Keep the prior revision active. |

Do not send an external notification for every informational file change by
default. A useful default is one revision summary per Source, plus immediate
notification for selected-part removal, lost access, and repeated monitoring
failure.

## Failure and rate-limit handling

- Store the last good observation and Source revision separately from the last
  attempted check. A failure never changes either one.
- Parse provider responses at the adapter boundary. Preserve provider request
  IDs and safe error details for support.
- For GitHub, use `ETag` or `Last-Modified` conditional requests, read
  `x-ratelimit-remaining` and `x-ratelimit-reset`, and stop until reset after a
  primary-limit response. Honor `retry-after` for secondary limits. GitHub
  documents `403` or `429` for rate limits and recommends increasing backoff
  for repeated secondary-limit failures.
  [GitHub rate-limit handling](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api#exceeding-the-rate-limit)
- Serialize checks per credential and provider. Do not launch one request per
  Source concurrently.
- Give every provider request separate connect and read deadlines plus a total
  deadline. Propagate shutdown cancellation into in-flight requests. A timeout
  records a bounded retryable failure, releases the credential scheduler, and
  lets the next due Source proceed. Cover a hung endpoint and scheduler resume.
- Retry network errors and `5xx` responses with bounded exponential backoff and
  jitter. Treat invalid credentials and permission failures as user action,
  not a fast retry loop.
- Let the user choose a broad schedule such as disabled, daily, or weekly.
  Provider and credential limits decide the actual next run. `Check now`
  should enqueue work behind the same limiter.
- If GitHub returns a truncated recursive tree, traverse non-recursive
  subtrees or use an archive and build the manifest locally. Never accept a
  partial tree.
- Detect Git LFS pointer contents before hashing or validating printable files.
  Until the adapter can retrieve and verify the referenced LFS object through
  supported authenticated Git LFS transport, reject that candidate as
  `lfs_object_unavailable`; never treat the pointer text as the model bytes.
  Keep a fixture containing the standard Git LFS pointer header and prove the
  prior complete revision stays active.
- GitHub can return `404` for an object that exists but is hidden from the
  current credential. Classify that response as `auth_required` when the
  credential is absent or invalid, or `inaccessible` when existence cannot be
  distinguished safely. Use `not_found` only when the provider and verified
  access context make removal unambiguous.
- Verify every expected download and digest before committing the Source
  revision. Do not silently apply a 500-file cap.
- Marketplace manual imports remain available when provider access, login, or
  paid-file rules prevent automatic retrieval. PrintPartner must not ask for
  or reuse the user's browser cookies.
- A webhook event that arrives twice must converge on one observation and one
  alert. A missed webhook is repaired by the next poll.

## Delivery sequence

1. Extend Phase 1 with Library Source, Source revision, Source revision file,
   and Build Source. Migrate each existing project into one Library Source and
   create an initial revision only after running the Phase 2 candidate
   validator, or the same validator extracted for migration. Quarantine any
   current snapshot that is incomplete or contains stale files.
2. Move import rules and file selections from the shared project to Build
   Source. Existing Builds receive their own copied rules during migration.
3. Complete Phase 2 atomic candidate download and manifest validation. Remove
   the mutable in-place promotion path and silent 500-file download cap.
   Preserve the provider's truncated-tree signal, traverse subtrees or use a
   verified archive fallback, and quarantine every failed candidate.
4. Add manifest comparison and a durable in-app alert inbox. Keep automatic
   Build movement off.
5. Replace the current checker with the GitHub native adapter, conditional
   requests, typed failure states, and rate-aware scheduling.
6. Wire `Review in Plan` to a Plan draft. Record pinned Source revisions in the
   applied Plan revision before changing freshness behavior.
7. Turn Printables, MakerWorld, Thangs, archive, and local folder uploads into
   first-class manual revision adapters.
8. Fan durable alerts out to the existing Discord and outbound webhook paths.
9. Add GitHub owner and narrow topic discovery as review-only Source
   suggestions. Keep marketplace creator subscriptions as native-page links
   and manual imports.
10. Consider GitHub App webhooks after the polling workflow is proven and the
   deployment can expose a secure public receiver.

## Open decisions

Snapshot retention is reference-aware. Never delete bytes referenced by an
active Build Source, accepted Plan revision, Plate revision, or Printer job.
Garbage collection begins from those records, marks every reachable Source
revision and artifact, and commits a mark generation with tombstones for
unreachable candidates. New Build, Plan, Plate, and Printer-job references must
reject tombstoned snapshots. A deletion worker takes a per-Source GC lock and,
in a serializable transaction, rechecks references and changes still-unreferenced
tombstones to `deleting`. Reference creation uses the same lock protocol and
rejects both states. After commit, delete the object-store bytes; on failure,
keep `deleting` for an idempotent retry. A concurrent-reference test races each
Build, Plan, Plate, and Printer-job reference against GC and proves either the
reference wins or deletion wins, never both. A missing or corrupt referenced
snapshot marks the Source unhealthy, blocks export or replay from those bytes,
preserves metadata and history, and offers an authenticated refetch only when
the exact provider revision remains available.

1. How long should PrintPartner retain unreachable snapshot bytes? Keeping
   manifests forever is cheap; keeping every unreferenced large archive may
   need a per-Source policy.
2. Should a GitHub candidate download automatically after detection, or wait
   for `Fetch revision`? Automatic fetch gives an immediate diff but uses more
   storage and bandwidth. It still must not update a Build.
3. Which files count as printable Source content in the first release: STL and
   3MF only, or also OBJ, STEP, and CAD source files?
4. Should documentation-only changes notify externally, or appear only in the
   in-app Source inbox?
5. What monitoring choices should the UI expose beyond disabled, daily, and
   weekly?
6. Is a hosted or otherwise public HTTPS deployment common enough to include
   GitHub webhook setup in the first monitoring release?
7. Should marketplace Sources offer a recurring `Review due` reminder? This is
   honest about the missing API, but it is a reminder rather than update
   detection.

An exact content rename is settled: carry the existing Build selection and
manual overrides into the draft automatically. Require confirmation only when
the new path changes inferred selection, role, or quantity.

The hard boundary should not remain open: unless a marketplace publishes a
supported API or grants an integration contract, PrintPartner will not scrape
it or depend on its private website requests.
