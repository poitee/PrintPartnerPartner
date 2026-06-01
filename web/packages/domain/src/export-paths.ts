import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";

export type ExportType = "checklist" | "3mf" | "stl" | "stl-missing" | "kit";

export function safePlanSlug(profileName: string): string {
  const slug = (profileName || "export")
    .replace(/\s+/g, "_")
    .replace(/[^\w\-.]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return slug || "export";
}

export function profileExportDir(exportsDir: string, profileName: string, exportType: ExportType): string {
  return join(exportsDir, safePlanSlug(profileName), exportType);
}

export function exportPathForChecklist(profileName: string, exportsDir: string): string {
  return join(profileExportDir(exportsDir, profileName, "checklist"), "checklist.html");
}

export function prepareFreshExportDir(
  exportsDir: string,
  profileName: string,
  exportType: ExportType,
): string {
  const path = join(exportsDir, safePlanSlug(profileName), exportType);
  if (existsSync(path)) {
    rmSync(path, { recursive: true, force: true });
  }
  mkdirSync(path, { recursive: true });
  return path;
}

export function exportPathForKit(name: string, exportsDir: string): string {
  const stamp = new Date().toISOString().replace(/[-:]/g, "").slice(0, 15);
  const stem = safePlanSlug(name).slice(0, 80) || "kit";
  const kitDir = profileExportDir(exportsDir, name, "kit");
  mkdirSync(kitDir, { recursive: true });
  return join(kitDir, `${stem}-${stamp}.print-partner-kit.zip`);
}
