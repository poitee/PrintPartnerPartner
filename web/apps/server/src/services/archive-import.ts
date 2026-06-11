import AdmZip from "adm-zip";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";

export const MAX_ZIP_ENTRIES = 10_000;
export const MAX_ZIP_UNCOMPRESSED_BYTES = 4 * 1024 * 1024 * 1024; // 4 GiB

export type ExtractLimits = {
  maxEntries?: number;
  maxUncompressedBytes?: number;
};

/**
 * Extract entries one by one instead of `extractAllTo` so each entry path is
 * validated against zip-slip, and total uncompressed size / entry count are
 * bounded against zip bombs.
 */
function extractEntries(zip: AdmZip, destDir: string, limits: ExtractLimits = {}): number {
  const maxEntries = limits.maxEntries ?? MAX_ZIP_ENTRIES;
  const maxBytes = limits.maxUncompressedBytes ?? MAX_ZIP_UNCOMPRESSED_BYTES;
  const base = resolve(destDir);
  mkdirSync(base, { recursive: true });
  const entries = zip.getEntries();
  if (entries.length > maxEntries) {
    throw new Error(`Archive has too many entries (${entries.length}, max ${maxEntries})`);
  }
  let totalBytes = 0;
  let stlCount = 0;
  for (const entry of entries) {
    // Zip-slip guard: normalize separators, strip leading slashes, reject any
    // ".." segment, and require the resolved target to stay under destDir.
    const entryName = entry.entryName.replace(/\\/g, "/").replace(/^\/+/, "");
    if (!entryName || entryName === "." || entryName.split("/").includes("..")) {
      throw new Error(`Archive entry escapes extraction directory: ${entry.entryName}`);
    }
    const target = resolve(base, entryName);
    if (!target.startsWith(base + sep)) {
      throw new Error(`Archive entry escapes extraction directory: ${entry.entryName}`);
    }
    if (entry.isDirectory) {
      mkdirSync(target, { recursive: true });
      continue;
    }
    if (totalBytes + entry.header.size > maxBytes) {
      throw new Error("Archive uncompressed size exceeds limit");
    }
    const data = entry.getData();
    totalBytes += data.length; // header sizes can lie; count real bytes
    if (totalBytes > maxBytes) {
      throw new Error("Archive uncompressed size exceeds limit");
    }
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, data);
    if (entry.entryName.toLowerCase().endsWith(".stl")) stlCount++;
  }
  return stlCount;
}

export function extractZipToDir(zipPath: string, destDir: string, limits?: ExtractLimits): number {
  return extractEntries(new AdmZip(zipPath), destDir, limits);
}

export function extractZipBuffer(buffer: Buffer, destDir: string, limits?: ExtractLimits): number {
  return extractEntries(new AdmZip(buffer), destDir, limits);
}

export function writeUploadedZip(buffer: Buffer, sourcesDir: string, sourceId: number): string {
  const dir = join(sourcesDir, String(sourceId));
  mkdirSync(dir, { recursive: true });
  const zipPath = join(dir, "upload.zip");
  writeFileSync(zipPath, buffer);
  const extractDir = join(dir, "files");
  try {
    rmSync(extractDir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
  extractZipBuffer(buffer, extractDir);
  return extractDir;
}
