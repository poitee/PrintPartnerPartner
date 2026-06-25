import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  assertFileUnderRoot,
  createReadStreamUnderRoot,
  readBufferUnderDataDir,
  resolvedFileUnderRoot,
  safeDataDirPath,
  safePathUnderRoot,
  trimmedString,
} from "./secure-path.js";

describe("secure-path", () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const dir of dirs) {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    }
    dirs.length = 0;
  });

  function tempDir(): string {
    const dir = mkdtempSync(join(tmpdir(), "pp-secure-"));
    dirs.push(dir);
    return dir;
  }

  it("rejects traversal in safePathUnderRoot", () => {
    const root = tempDir();
    expect(safePathUnderRoot(root, "../etc/passwd")).toBeNull();
    expect(safePathUnderRoot(root, "ok/file.txt")).not.toBeNull();
  });

  it("resolvedFileUnderRoot rejects paths outside root", () => {
    const root = tempDir();
    const file = join(root, "kit.json");
    writeFileSync(file, "{}");
    expect(resolvedFileUnderRoot(root, file)).toBe(file);
    expect(resolvedFileUnderRoot(root, "/etc/passwd")).toBeNull();
  });

  it("createReadStreamUnderRoot only opens files under root", () => {
    const root = tempDir();
    mkdirSync(join(root, "exports"), { recursive: true });
    writeFileSync(join(root, "exports", "pack.zip"), "zip");
    expect(createReadStreamUnderRoot(root, "../secret")).toBeNull();
    const file = assertFileUnderRoot(join(root, "exports"), "pack.zip");
    expect(file.endsWith("pack.zip")).toBe(true);
  });

  it("readBufferUnderDataDir rejects paths outside data dir", () => {
    const dataDir = tempDir();
    writeFileSync(join(dataDir, "kit.print-partner-kit"), "{}");
    expect(() => readBufferUnderDataDir(dataDir, "/etc/passwd")).toThrow();
    expect(readBufferUnderDataDir(dataDir, join(dataDir, "kit.print-partner-kit")).length).toBeGreaterThan(0);
  });

  it("trimmedString only accepts strings", () => {
    expect(trimmedString("  x  ")).toBe("x");
    expect(trimmedString(null)).toBe("");
    expect(trimmedString(42)).toBe("");
  });

  it("safeDataDirPath confines absolute paths", () => {
    const dataDir = tempDir();
    const inside = join(dataDir, "nested", "file.bin");
    mkdirSync(join(dataDir, "nested"), { recursive: true });
    writeFileSync(inside, "x");
    expect(safeDataDirPath(dataDir, inside)).toBe(inside);
    expect(safeDataDirPath(dataDir, "/tmp/outside")).toBeNull();
  });
});
