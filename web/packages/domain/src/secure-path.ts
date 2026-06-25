import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";

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

export function readFileUnderRoot(root: string, absolutePath: string, encoding?: BufferEncoding): string {
  const file = resolvedFileUnderRoot(root, absolutePath);
  if (!file) throw new Error("Path must be a file under the export directory");
  return readFileSync(file, encoding ?? "utf8");
}

export function readFileBufferUnderRoot(root: string, absolutePath: string): Buffer {
  const file = resolvedFileUnderRoot(root, absolutePath);
  if (!file) throw new Error("Path must be a file under the export directory");
  return readFileSync(file);
}
