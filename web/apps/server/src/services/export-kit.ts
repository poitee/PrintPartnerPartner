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

export function loadKitBundleBytes(path: string): Record<string, unknown> {
  const buf = readFileSync(path);
  let raw: string;
  if (path.endsWith(".zip") || path.includes(".print-partner-kit.zip")) {
    const zip = new AdmZip(buf);
    const entry = zip.getEntry(KIT_JSON_NAME);
    if (!entry) throw new Error(`Missing ${KIT_JSON_NAME} in kit archive`);
    raw = entry.getData().toString("utf8");
  } else {
    raw = buf.toString("utf8");
  }
  const data = JSON.parse(raw) as Record<string, unknown>;
  if (data.format !== KIT_FORMAT) throw new Error("Not a Print Partner kit file");
  const version = Number(data.version ?? 0);
  if (![1, 2, 3].includes(version)) throw new Error("Unsupported kit version");
  return data;
}

export { KIT_FORMAT, KIT_VERSION };
