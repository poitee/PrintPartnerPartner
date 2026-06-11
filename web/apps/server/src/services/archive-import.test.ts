import { describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import AdmZip from "adm-zip";
import { extractZipBuffer } from "./archive-import.js";

function tempRoot(): string {
  return mkdtempSync(join(tmpdir(), "pp-archive-"));
}

/** adm-zip sanitizes names in addFile, so force a hostile entry name afterwards. */
function addMaliciousEntry(zip: AdmZip, name: string, data: Buffer): void {
  zip.addFile("placeholder-entry", data);
  const entry = zip.getEntries().find((e) => e.entryName === "placeholder-entry")!;
  entry.entryName = name;
}

describe("archive extraction hardening", () => {
  it("extracts a normal archive and counts STL files", () => {
    const root = tempRoot();
    const zip = new AdmZip();
    zip.addFile("README.md", Buffer.from("# Kit"));
    zip.addFile("parts/bracket.stl", Buffer.from("solid bracket"));
    zip.addFile("parts/nested/clip.STL", Buffer.from("solid clip"));

    const dest = join(root, "files");
    const count = extractZipBuffer(zip.toBuffer(), dest);

    expect(count).toBe(2);
    expect(existsSync(join(dest, "parts/bracket.stl"))).toBe(true);
    expect(existsSync(join(dest, "parts/nested/clip.STL"))).toBe(true);
    rmSync(root, { recursive: true, force: true });
  });

  it("rejects zip-slip entries that traverse out of the destination", () => {
    const root = tempRoot();
    const zip = new AdmZip();
    zip.addFile("ok.stl", Buffer.from("solid ok"));
    addMaliciousEntry(zip, "../evil.txt", Buffer.from("pwned"));

    const dest = join(root, "files");
    expect(() => extractZipBuffer(zip.toBuffer(), dest)).toThrow(
      /escapes extraction directory/,
    );
    expect(existsSync(join(root, "evil.txt"))).toBe(false);
    rmSync(root, { recursive: true, force: true });
  });

  it("rejects deeply nested traversal entries", () => {
    const root = tempRoot();
    const zip = new AdmZip();
    addMaliciousEntry(zip, "a/b/../../../../tmp/evil.stl", Buffer.from("solid evil"));

    expect(() => extractZipBuffer(zip.toBuffer(), join(root, "files"))).toThrow(
      /escapes extraction directory/,
    );
    rmSync(root, { recursive: true, force: true });
  });

  it("neutralizes absolute entry paths under the destination", () => {
    const root = tempRoot();
    const zip = new AdmZip();
    addMaliciousEntry(zip, "/abs/part.stl", Buffer.from("solid abs"));

    const dest = join(root, "files");
    const count = extractZipBuffer(zip.toBuffer(), dest);
    expect(count).toBe(1);
    expect(existsSync(join(dest, "abs/part.stl"))).toBe(true);
    rmSync(root, { recursive: true, force: true });
  });

  it("rejects archives with too many entries", () => {
    const root = tempRoot();
    const zip = new AdmZip();
    zip.addFile("a.txt", Buffer.from("a"));
    zip.addFile("b.txt", Buffer.from("b"));
    zip.addFile("c.txt", Buffer.from("c"));

    expect(() =>
      extractZipBuffer(zip.toBuffer(), join(root, "files"), { maxEntries: 2 }),
    ).toThrow(/too many entries/);
    rmSync(root, { recursive: true, force: true });
  });

  it("rejects archives whose uncompressed size exceeds the limit", () => {
    const root = tempRoot();
    const zip = new AdmZip();
    zip.addFile("big.bin", Buffer.alloc(64 * 1024, 0));

    expect(() =>
      extractZipBuffer(zip.toBuffer(), join(root, "files"), {
        maxUncompressedBytes: 1024,
      }),
    ).toThrow(/uncompressed size exceeds limit/);
    rmSync(root, { recursive: true, force: true });
  });
});
