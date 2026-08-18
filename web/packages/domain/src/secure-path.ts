import { readFileSync, realpathSync, statSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";

/** Ensure an absolute path resolves to a regular file under root. */
export function resolvedFileUnderRoot(root: string, absolutePath: string): string | null {
  try {
    const base = realpathSync(resolve(root));
    const candidate = realpathSync(resolve(absolutePath));
    const relativePath = relative(base, candidate);
    if (relativePath === ".." || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath)) {
      return null;
    }
    if (!statSync(candidate).isFile()) return null;
    return candidate;
  } catch {
    return null;
  }
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
