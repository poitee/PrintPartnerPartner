/** Mirror of backend export_paths.py for tests and UI helpers. */

export function safePlanSlug(profileName: string): string {
  const slug = (profileName || "export")
    .replace(/ /g, "_")
    .replace(/[^\w\-.]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return slug || "export";
}

export function profileExportDir(
  exportsRoot: string,
  profileName: string,
  exportType: "checklist" | "3mf" | "stl" | "stl-missing" | "kit",
): string {
  const root = exportsRoot.replace(/\/+$/, "");
  return `${root}/${safePlanSlug(profileName)}/${exportType}`;
}

export function exportDirForStlMissing(exportsRoot: string, profileName: string): string {
  return profileExportDir(exportsRoot, profileName, "stl-missing");
}

export function parentDirectory(filePath: string): string {
  const normalized = filePath.replace(/\\/g, "/");
  const idx = normalized.lastIndexOf("/");
  if (idx <= 0) return normalized;
  return normalized.slice(0, idx);
}
