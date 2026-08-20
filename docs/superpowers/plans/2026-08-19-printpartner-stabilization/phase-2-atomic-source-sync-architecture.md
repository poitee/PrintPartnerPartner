# Phase 2 atomic Source sync architecture

## Caller usage

`syncProjectById` remains the workflow boundary. A GitHub sync resolves one commit, materializes one immutable local snapshot, records its Source Revision, and activates it before derived work runs.

`githubSnapshots.materialize` is the provider coordinator: it resolves the ref once, rejects an incomplete tree, selects the bounded file set, and delegates the resolved revision key, selection record, file descriptors, and commit-pinned stream opener to `LocalSourceSnapshotStore.materialize`. Progress remains provider-facing; candidate and filesystem mechanics remain inside the store.

```ts
const observed = repo.getProjectRow(sourceId);
const snapshot = await githubSnapshots.materialize({
  sourceId,
  url: observed.url,
  ref: observed.tag ?? observed.branch ?? "main",
  token,
  maxStlFiles: 500,
  maxDocsBytes,
  onProgress,
});

const revision = repo.recordSourceRevision({
  sourceId,
  upstreamRevisionKey: snapshot.upstreamRevisionKey,
  manifestDigest: snapshot.manifestDigest,
  snapshotLocator: snapshot.snapshotLocator,
  syncedAt: new Date().toISOString(),
  completeness: "complete",
});

const activation = repo.activateSourceRevision({
  sourceId,
  revisionId: revision.id,
  observed,
});
```

The caller never creates candidate paths, writes snapshot files, hashes content, or renames directories.

## Public shape

```ts
type SnapshotFile = {
  path: SourceRelativePath;
  kind: "stl" | "readme" | "md" | "pdf";
  sizeHintBytes: number | null;
};

type SnapshotContentFile = {
  path: SourceRelativePath;
  kind: "stl" | "readme" | "md" | "pdf";
  sizeBytes: number;
  sha256: string;
};

type PublishedSourceSnapshot = {
  upstreamRevisionKey: string;
  manifestDigest: string;
  snapshotLocator: string;
  absolutePath: string;
  files: readonly SnapshotContentFile[];
  selection: SnapshotSelection;
  publication: "created" | "reused";
};

interface LocalSourceSnapshotStore {
  materialize(input: {
    sourceId: number;
    upstreamRevisionKey: string;
    files: readonly SnapshotFile[];
    selection: SnapshotSelection;
    openFile(file: SnapshotFile): Promise<{
      stream: NodeJS.ReadableStream;
      contentLengthBytes: number | null;
    }>;
  }): Promise<PublishedSourceSnapshot>;
}
```

`projects.current_source_revision_id` is the authoritative active revision. `local_path`, `last_commit_sha`, and `last_synced_at` remain compatibility fields and change only in the guarded activation operation for GitHub Sources.

## Module ownership

- `services/local-source-snapshot.ts` owns path validation, revision layout, candidates, streaming writes, byte counts, hashes, canonical manifests, existing-snapshot validation, cleanup, and atomic rename.
- `services/github-sync.ts` owns GitHub URL parsing, ref resolution, complete tree parsing, deterministic file selection, and raw streams pinned to the resolved commit SHA.
- `db/repository.ts` owns idempotent revision registration and guarded activation.
- `routes/sources.ts` owns orchestration and post-publication derived work.
- PDF text caches and the editable PrintPartner manifest live outside immutable revision directories.

## Storage and manifest

```text
repos/<source-id>/
  revisions/
    .candidate-<commit>-<random>/
    <commit>/
      .printpartner-source-snapshot.json
      ...selected upstream files
  derived/<manifest-digest>/pdf-text/
  print-partner.manifest.yaml
```

The stored locator is `source-id/revisions/commit`, relative to `reposDir`. Candidate and final directories are siblings. Promotion is one rename; `EXDEV` fails and never falls back to copying.

Phase 1 permits one Source Revision per Source and upstream revision key, so the first complete snapshot for a commit fixes that commit's selected document set. Later selection-setting changes are ignored for that already-published commit: the store verifies and returns the original manifest, files, selection, and digest without downloading or sharing the directory with a second selection state. It never creates a competing directory or overwrites the first. A future selection-policy version needs an explicit identity migration rather than an implicit locator suffix.

The manifest contains a versioned selection record and sorted content entries `{ path, kind, sizeBytes, sha256 }`. `manifest_digest` is SHA-256 over the canonical content entries only. It excludes timestamps, paths outside the snapshot, download order, and selection settings.

All STLs are selected. Exceeding the configured STL limit fails before candidate creation. Documentation omitted by the deterministic byte budget is recorded as intentionally omitted. A GitHub truncated tree, unsafe path, duplicate normalized path, non-blob entry, failed response, failed stream, response-length mismatch, missing file, extra file, or content mismatch cannot publish a revision.

Git tree sizes are selection hints, not integrity checks. Documents with unknown tree sizes are omitted with the explicit `unknown-document-size` reason so they cannot bypass the byte budget or abort otherwise valid STL acquisition. The snapshot store also enforces the byte and STL limits against the materialized content before publication.

## Commit order and recovery

1. Capture the Source configuration and current revision.
2. Resolve the ref to a commit and reject a truncated tree.
3. Select files and create a candidate under the Source revision root.
4. Stream, hash, count, and validate every selected file.
5. Write the canonical manifest and atomically rename the candidate.
6. Idempotently record the complete Source Revision.
7. Guard activation against changes to the observed current revision, URL, branch, tag, kind, path, and commit.
8. Index documents, extract PDF text to derived storage, and refresh the cover as repairable post-processing.

A failure before rename removes only the candidate. A failure after rename leaves a valid unregistered snapshot that a retry reuses. A failure after registration leaves an inactive revision. A stale activation never overwrites a newer Source configuration or revision.

These recovery guarantees cover process failures and atomic visibility on the configured local filesystem. They do not claim durability across host power loss because Phase 2 does not fsync every streamed file and directory; crash-durable publication can be added as a separate storage capability.

## Synthesis decision

The arena selected the explicit active-revision design because Phase 3 needs a durable current revision identity. It grafts the competing design's deeper filesystem boundary: the snapshot store accepts streams, owns every byte written, and keeps generated or user-owned files outside revision content.

The first safe implementation unit is the snapshot store and its failure tests. The GitHub adapter, revision pointer, orchestration, and derived-writer migration follow only after that boundary proves atomic publication and retry behavior.
