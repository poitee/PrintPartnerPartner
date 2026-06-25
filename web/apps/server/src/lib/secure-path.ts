import { createReadStream, existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import type { ReadStream } from "node:fs";
import { join, resolve } from "node:path";
import { resolveCaseInsensitiveRepoPath } from "../services/part-paths.js";
import { globalPreviewPath, globalThumbnailPath } from "./thumbnails.js";

/** Walk relative path under root using directory listings only (no user strings in join). */
function resolveFileByWalk(root: string, relativeKey: string): string | null {
  const normalized = relativeKey.replace(/\\/g, "/").replace(/^\/+/, "");
  if (!normalized || normalized.includes("..") || normalized.includes("\0")) return null;
  const parts = normalized.split("/").filter(Boolean);
  if (!parts.length) return null;
  let current = resolve(root);
  const base = current;
  for (const part of parts) {
    let entries: string[];
    try {
      entries = readdirSync(current);
    } catch {
      return null;
    }
    const match = entries.find((entry) => entry === part);
    if (!match) return null;
    current = join(current, match);
  }
  try {
    if (!statSync(current).isFile()) return null;
    if (current !== base && !current.startsWith(`${base}/`)) return null;
    return current;
  } catch {
    return null;
  }
}

function readStreamForFileUnderRoot(root: string, file: string): ReadStream | null {
  const base = resolve(root);
  const candidate = resolve(file);
  if (candidate !== base && !candidate.startsWith(`${base}/`)) return null;
  try {
    if (!statSync(candidate).isFile()) return null;
  } catch {
    return null;
  }
  return createReadStream(candidate);
}

/** Resolve a relative path under root; reject traversal outside root. */
export function safePathUnderRoot(root: string, relativePath: string): string | null {
  const normalized = relativePath.replace(/\\/g, "/").replace(/^\/+/, "");
  if (!normalized || normalized.includes("..")) return null;
  const base = resolve(root);
  const candidate = resolve(base, normalized);
  if (candidate !== base && !candidate.startsWith(`${base}/`)) return null;
  return candidate;
}

/** Ensure an absolute path resolves to a regular file under root. */
export function resolvedFileUnderRoot(root: string, absolutePath: string): string | null {
  const base = resolve(root);
  const candidate = resolve(absolutePath);
  if (candidate !== base && !candidate.startsWith(`${base}/`)) return null;
  try {
    if (!statSync(candidate).isFile()) return null;
  } catch {
    return null;
  }
  return candidate;
}

export function createReadStreamUnderRoot(root: string, relativePath: string): ReadStream | null {
  const file = resolveFileByWalk(root, relativePath);
  return file ? readStreamForFileUnderRoot(root, file) : null;
}

export function openExportFileStream(dataDir: string, userKey: string): ReadStream | null {
  return createReadStreamUnderRoot(join(dataDir, "exports"), userKey);
}

export function openRepoStlMeshStream(
  repoRoot: string,
  relativePath: string,
  maxBytes: number,
): ReadStream | null {
  const file =
    resolveFileByWalk(repoRoot, relativePath) ??
    resolveCaseInsensitiveRepoPath(repoRoot, relativePath);
  if (!file) return null;
  try {
    const st = statSync(file);
    if (!st.isFile() || st.size > maxBytes) return null;
  } catch {
    return null;
  }
  return readStreamForFileUnderRoot(repoRoot, file);
}

export function openStlThumbStream(
  thumbsDir: string,
  repoRoot: string,
  relativePath: string,
  variant: "preview" | "thumb",
): ReadStream | null {
  const stl =
    resolveFileByWalk(repoRoot, relativePath) ??
    resolveCaseInsensitiveRepoPath(repoRoot, relativePath);
  if (!stl) return null;
  const thumbPath =
    variant === "preview"
      ? globalPreviewPath(thumbsDir, stl, "primary", null)
      : globalThumbnailPath(thumbsDir, stl, "primary", null);
  return readStreamForFileUnderRoot(thumbsDir, thumbPath);
}

export function readBufferUnderDataDir(dataDir: string, userPath: string): Buffer {
  const root = resolve(dataDir);
  const resolved = resolve(userPath);
  if (resolved !== root && !resolved.startsWith(`${root}/`)) {
    throw new Error("Path must be under the Print Partner data directory");
  }
  const relative = resolved.slice(root.length).replace(/^\/+/, "");
  if (!relative || !/\.print-partner-kit(\.zip)?$/i.test(relative)) {
    throw new Error("Kit path must be a .print-partner-kit bundle under the data directory");
  }
  const file = resolveFileByWalk(root, relative);
  if (!file) throw new Error("Kit file not found");
  return readFileSync(file);
}

export function trimmedString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function assertFileUnderRoot(root: string, relativePath: string, maxBytes?: number): string {
  const file = resolveFileByWalk(root, relativePath);
  if (!file || !existsSync(file)) {
    throw new Error("File not found");
  }
  const st = statSync(file);
  if (!st.isFile()) throw new Error("Not a file");
  if (maxBytes != null && st.size > maxBytes) {
    throw new Error(`File exceeds ${Math.floor(maxBytes / (1024 * 1024))}MB limit`);
  }
  return file;
}

/** Map an absolute path to a URL-safe export download key under dataDir/exports. */
export function exportDownloadKey(dataDir: string, absolutePath: string): string | null {
  const exportsRoot = resolve(dataDir, "exports");
  const file = resolve(absolutePath);
  if (file !== exportsRoot && !file.startsWith(`${exportsRoot}/`)) return null;
  return file.slice(exportsRoot.length).replace(/^\/+/, "");
}

/** Resolve kit import path: must exist under dataDir (self-host local paths only). */
export function safeDataDirPath(dataDir: string, userPath: string): string | null {
  const resolved = resolve(userPath);
  const root = resolve(dataDir);
  if (resolved !== root && !resolved.startsWith(`${root}/`)) return null;
  return resolved;
}
