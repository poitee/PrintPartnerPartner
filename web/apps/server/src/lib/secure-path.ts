import { existsSync, statSync } from "node:fs";
import { resolve } from "node:path";

/** Resolve a relative path under root; reject traversal outside root. */
export function safePathUnderRoot(root: string, relativePath: string): string | null {
  const normalized = relativePath.replace(/\\/g, "/").replace(/^\/+/, "");
  if (!normalized || normalized.includes("..")) return null;
  const base = resolve(root);
  const candidate = resolve(base, normalized);
  if (candidate !== base && !candidate.startsWith(`${base}/`)) return null;
  return candidate;
}

export function assertFileUnderRoot(root: string, relativePath: string, maxBytes?: number): string {
  const full = safePathUnderRoot(root, relativePath);
  if (!full || !existsSync(full)) {
    throw new Error("File not found");
  }
  const st = statSync(full);
  if (!st.isFile()) throw new Error("Not a file");
  if (maxBytes != null && st.size > maxBytes) {
    throw new Error(`File exceeds ${Math.floor(maxBytes / (1024 * 1024))}MB limit`);
  }
  return full;
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
