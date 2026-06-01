import { readFileSync, writeFileSync } from "node:fs";
import AdmZip from "adm-zip";
import { zipSync } from "fflate";
import { exportPathForKit } from "@print-partner/domain";
import type { AppRepository } from "../db/repository.js";

const KIT_FORMAT = "print-partner-kit";
const KIT_VERSION = 3;
const KIT_JSON_NAME = "kit.json";

export function exportKitBundle(
  repo: AppRepository,
  profileId: number,
  exportsDir: string,
  includePrintProgress: boolean,
): string {
  const bundle = repo.buildKitBundle(profileId, includePrintProgress);
  const dest = exportPathForKit(bundle.profile.name, exportsDir);
  const payload = new TextEncoder().encode(JSON.stringify(bundle.data, null, 2));
  const zipped = zipSync({ [KIT_JSON_NAME]: payload });
  writeFileSync(dest, Buffer.from(zipped));
  return dest;
}

function parseKitBundleRaw(raw: string): Record<string, unknown> {
  const data = JSON.parse(raw) as Record<string, unknown>;
  if (data.format !== KIT_FORMAT) throw new Error("Not a Print Partner kit file");
  const version = Number(data.version ?? 0);
  if (![1, 2, 3].includes(version)) throw new Error("Unsupported kit version");
  return data;
}

/** Parse kit.json or .print-partner-kit.zip bytes from a browser upload. */
export function parseKitBundleBuffer(buf: Buffer, filename?: string): Record<string, unknown> {
  const name = (filename ?? "").toLowerCase();
  const looksZip =
    name.endsWith(".zip") ||
    name.includes(".print-partner-kit") ||
    (buf.length >= 2 && buf[0] === 0x50 && buf[1] === 0x4b);
  if (looksZip) {
    const zip = new AdmZip(buf);
    const entry = zip.getEntry(KIT_JSON_NAME);
    if (!entry) throw new Error(`Missing ${KIT_JSON_NAME} in kit archive`);
    return parseKitBundleRaw(entry.getData().toString("utf8"));
  }
  return parseKitBundleRaw(buf.toString("utf8"));
}

export function loadKitBundleBytes(path: string): Record<string, unknown> {
  const buf = readFileSync(path);
  return parseKitBundleBuffer(buf, path);
}

export { KIT_FORMAT, KIT_VERSION };
