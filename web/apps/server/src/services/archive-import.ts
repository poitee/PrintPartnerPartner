import AdmZip from "adm-zip";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export function extractZipToDir(zipPath: string, destDir: string): number {
  const zip = new AdmZip(zipPath);
  mkdirSync(destDir, { recursive: true });
  zip.extractAllTo(destDir, true);
  let count = 0;
  for (const entry of zip.getEntries()) {
    if (!entry.isDirectory && entry.entryName.toLowerCase().endsWith(".stl")) {
      count++;
    }
  }
  return count;
}

export function extractZipBuffer(buffer: Buffer, destDir: string): number {
  const zip = new AdmZip(buffer);
  mkdirSync(destDir, { recursive: true });
  zip.extractAllTo(destDir, true);
  return zip
    .getEntries()
    .filter((e) => !e.isDirectory && e.entryName.toLowerCase().endsWith(".stl")).length;
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
