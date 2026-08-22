import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, readdir, readFile } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import type { SourceSummary } from "@print-partner/contracts";
import type { AppRepository } from "../db/repository.js";
import {
  LocalSourceSnapshotStore,
  sourceRelativePath,
  type SnapshotFile,
  type SnapshotFileKind,
} from "./local-source-snapshot.js";

export const DEFAULT_LOCAL_SNAPSHOT_STL_LIMIT = 500;
export const DEFAULT_LOCAL_SNAPSHOT_DOCS_BYTES = 1024 * 1024 * 1024;

type CollectedSnapshotFile = {
  relativePath: string;
  absolutePath: string;
  kind: SnapshotFileKind;
  sizeHintBytes: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function classifySnapshotPath(path: string): SnapshotFileKind | null {
  const lower = path.toLowerCase();
  if (lower.endsWith(".stl")) return "stl";
  if (!lower.endsWith(".md") && !lower.endsWith(".pdf")) return null;
  if (lower.endsWith(".pdf")) return "pdf";
  const base = lower.split("/").pop() ?? lower;
  if (base === "readme.md" || base.startsWith("readme.")) return "readme";
  return "md";
}

function resolveUnderRoot(root: string, relativePath: string): string | null {
  const normalized = relativePath.replaceAll("\\", "/").replace(/^\/+/, "");
  if (!normalized || normalized.split("/").includes("..")) return null;
  const base = resolve(root);
  const target = resolve(base, normalized);
  if (target !== base && !target.startsWith(`${base}${sep}`)) return null;
  return target;
}

async function collectSnapshotFiles(root: string): Promise<CollectedSnapshotFile[]> {
  try {
    const rootStat = await lstat(root);
    if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) return [];
  } catch (error) {
    if (isRecord(error) && error.code === "ENOENT") return [];
    throw error;
  }
  const files: CollectedSnapshotFile[] = [];
  const walk = async (dir: string, relative: string): Promise<void> => {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      const rel = relative ? `${relative}/${entry.name}` : entry.name;
      const abs = join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(abs, rel);
        continue;
      }
      if (!entry.isFile()) continue;
      const kind = classifySnapshotPath(rel);
      if (!kind) continue;
      const stat = await lstat(abs);
      if (stat.isSymbolicLink() || !stat.isFile()) continue;
      sourceRelativePath(rel);
      files.push({
        relativePath: rel,
        absolutePath: abs,
        kind,
        sizeHintBytes: stat.size,
      });
    }
  };
  await walk(root, "");
  return files.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
}

async function digestWorkingTree(files: readonly CollectedSnapshotFile[]): Promise<string> {
  const hash = createHash("sha256");
  for (const file of files) {
    hash.update(file.relativePath);
    hash.update("\0");
    hash.update(await readFile(file.absolutePath));
    hash.update("\0");
  }
  return hash.digest("hex");
}

export async function publishLocalSourceWorkingTree(input: {
  repo: AppRepository;
  reposDir: string;
  sourceId: number;
  workingTree: string;
  maxStlFiles?: number;
  maxDocumentationBytes?: number;
}): Promise<SourceSummary> {
  const observed = input.repo.getProjectRow(input.sourceId);
  if (!observed) throw new Error("Source not found");

  const maxStlFiles = input.maxStlFiles ?? DEFAULT_LOCAL_SNAPSHOT_STL_LIMIT;
  const maxDocumentationBytes = input.maxDocumentationBytes ?? DEFAULT_LOCAL_SNAPSHOT_DOCS_BYTES;
  const collected = await collectSnapshotFiles(input.workingTree);
  const stlCount = collected.filter((file) => file.kind === "stl").length;
  if (stlCount > maxStlFiles) {
    throw new Error(
      `Local Source contains ${stlCount} STL files, exceeding the limit of ${maxStlFiles}`,
    );
  }
  const documentationBytes = collected
    .filter((file) => file.kind !== "stl")
    .reduce((sum, file) => sum + file.sizeHintBytes, 0);
  if (documentationBytes > maxDocumentationBytes) {
    throw new Error(
      `Local Source documentation exceeds the ${maxDocumentationBytes} byte limit`,
    );
  }

  const upstreamRevisionKey = await digestWorkingTree(collected);
  const files: SnapshotFile[] = collected.map((file) => ({
    path: sourceRelativePath(file.relativePath),
    kind: file.kind,
    sizeHintBytes: file.sizeHintBytes,
  }));
  const store = new LocalSourceSnapshotStore({ reposDir: input.reposDir });
  const snapshot = await store.materialize({
    sourceId: input.sourceId,
    upstreamRevisionKey,
    files,
    selection: {
      maxStlFiles,
      maxDocumentationBytes,
      omittedFiles: [],
    },
    openFile: async (file) => {
      const absolutePath = resolveUnderRoot(input.workingTree, file.path);
      if (!absolutePath) throw new Error(`Unsafe Source snapshot path: ${file.path}`);
      const stat = await lstat(absolutePath);
      return {
        stream: createReadStream(absolutePath),
        contentLengthBytes: stat.size,
      };
    },
  });

  const revision = input.repo.recordSourceRevision({
    sourceId: input.sourceId,
    upstreamRevisionKey: snapshot.upstreamRevisionKey,
    manifestDigest: snapshot.manifestDigest,
    snapshotLocator: snapshot.snapshotLocator,
    syncedAt: new Date().toISOString(),
    completeness: "complete",
  });
  const activated = input.repo.activateSourceRevision({
    sourceId: input.sourceId,
    revisionId: revision.id,
    observed,
  });
  input.repo.markSourceRevisionCurrent(input.sourceId, revision.id);
  return activated;
}
