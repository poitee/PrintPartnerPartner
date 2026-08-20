# Source state ownership architecture

## Decision

TanStack Query owns the browser's Source list at `queryKeys.sources`.
`SourcesPage`, `BuildPage`, `BuildSourcesPanel`, Welcome, Export, and the
workflow indicator all read that cache. Pages do not copy the list into local
state or fetch it directly.

Local state remains appropriate for unsaved forms, filters, selections, open
dialogs, and pending uploads. An open Source detail sheet stores a Source ID and
derives the current Source from the cache. It does not store a second
`SourceSummary` snapshot.

This unit does not create a Source context. The query cache already supplies
subscription, request deduplication, invalidation, and server-state lifecycle.

## Query module ownership

`queries/sources.ts` owns:

- the Source list query;
- create, update, delete, and bulk-category mutations;
- immediate cache upsert or removal from complete mutation responses; and
- invalidation of Source-dependent reads.

Complete mutation responses update `queryKeys.sources` before invalidation so
every visible subscriber changes together. Partial operations such as imports,
uploads, and background syncs invalidate because their response does not contain
the complete affected Source state.

The dependency invalidation policy covers:

- `queryKeys.sources` for Source cards and selectors;
- `queryKeys.profiles` for Plan freshness summaries; and
- the `planReview` query prefix for Source names and attached Source metadata.

The query module accepts a `QueryClient`. Pages do not call `setQueryData` for
Source rows.

## Page migration

`SourcesPage` reads `useSourcesQuery(engineReady)`. Its refresh action refetches
the shared query and Source categories. CRUD and bulk category actions use query
mutations. Upload and repo-import completion invalidate the shared Source data.

The page stores `detailSourceId`. The active `detailSource` is a lookup in the
cached list, so a category or name change updates the card and open sheet in the
same render.

`BuildPage` reads the same query and removes Sources from both profile load
paths. Source category assignment uses the shared update mutation. Layer state
is deliberately unchanged in this unit; Plan-layer ownership is the next
Phase 6 correction.

`BuildSourcesPanel` remains a query subscriber. Background job completion owns
cache invalidation, so the panel does not issue a second manual refetch after a
sync.

## Job boundary

The client job kind for update checks is `check-source-updates`, matching the
central invalidation matrix. A completed Source mutation job invalidates the
shared cache once. Page callbacks handle only user messages and local busy
state.

Direct sequential import and upload flows call the same exported Source
invalidation function when they finish.

## Verification

The unit passes when:

- a cache update changes three simultaneous Source subscribers without a
  reload;
- the Sources page card and its open detail sheet derive the same row;
- Build's parent and nested Source controls read the same cache;
- one update mutation upserts the cache and invalidates Source dependents;
- one delete mutation removes the row immediately;
- completed update-check jobs invalidate Sources under the correct job kind;
- page-local Source arrays and direct `fetchSources()` calls are gone; and
- focused tests, web typecheck, lint, and the repository quality gate pass.

Source categories use `queryKeys.sourceCategories` as their saved baseline.
Library, Plan, and Settings subscribe to that list. The category editor keeps
only its unsaved draft local, preserves it across background cache updates, and
publishes a successful save to every subscriber.
