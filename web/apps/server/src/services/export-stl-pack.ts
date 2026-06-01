import { copyFileSync, mkdirSync } from "node:fs";
import { basename, join } from "node:path";
import {
  folderKeyFromRelativePath,
  prepareFreshExportDir,
  quantityEffective,
  unprintedCopies,
  type MergePart,
} from "@print-partner/domain";

const ROLE_ORDER = ["primary", "accent", "clear", "opaque"] as const;

function safeFolderName(folderKey: string): string {
  if (folderKey === "(root)") return "_root";
  const safe = folderKey.replace(/\//g, "_").replace(/[^\w\-.]+/g, "_");
  return safe || "_root";
}

function entryName(part: MergePart, unit: number, usedNames: Set<string>): string {
  const stem = basename(part.filename, ".stl") || part.filename;
  const suffix = part.filename.toLowerCase().endsWith(".stl") ? "" : ".stl";
  const base = `${stem}_${String(unit).padStart(2, "0")}${suffix || ".stl"}`;
  if (!usedNames.has(base)) {
    usedNames.add(base);
    return base;
  }
  const parent = folderKeyFromRelativePath(part.relativePath);
  const prefix = parent.replace(/\//g, "_").replace(/[^\w\-.]+/g, "_");
  const candidate =
    prefix && prefix !== "(root)" ? `${prefix}_${base}` : `${part.matchKey.slice(0, 40).replace(/[^\w\-.]+/g, "_")}_${base}`;
  usedNames.add(candidate);
  return candidate;
}

export function exportProfileStlPack(
  profileName: string,
  parts: MergePart[],
  exportsDir: string,
  options: {
    missingOnly?: boolean;
    completedByMatchKey?: Record<string, boolean[]>;
    roleOrder?: string[];
  } = {},
): { rootPath: string; fileCounts: Record<string, number>; warnings: string[] } {
  const order = options.roleOrder ?? [...ROLE_ORDER];
  const exportType = options.missingOnly ? "stl-missing" : "stl";
  const outputRoot = prepareFreshExportDir(exportsDir, profileName, exportType);

  const included = parts.filter((p) => p.included);
  const missingPath = included.filter((p) => !p.absolutePath);
  const warnings: string[] = missingPath.map(
    (p) => `Missing STL: ${p.relativePath} (${p.sourceLayer})`,
  );

  const byRoleFolder = new Map<string, Map<string, Array<[MergePart, number]>>>();

  const addEntry = (part: MergePart, unit: number) => {
    const role = order.includes(part.role) ? part.role : "primary";
    const folder = folderKeyFromRelativePath(part.relativePath);
    if (!byRoleFolder.has(role)) byRoleFolder.set(role, new Map());
    const folders = byRoleFolder.get(role)!;
    if (!folders.has(folder)) folders.set(folder, []);
    folders.get(folder)!.push([part, unit]);
  };

  if (options.missingOnly) {
    const copies = unprintedCopies(parts, options.completedByMatchKey ?? {}, (p) => !!p);
    for (const copy of copies) addEntry(copy.part, copy.unit);
  } else {
    for (const part of included.filter((p) => p.absolutePath)) {
      const qty = Math.max(1, quantityEffective(part));
      for (let unit = 1; unit <= qty; unit++) addEntry(part, unit);
    }
  }

  if (options.missingOnly) {
    const any = [...byRoleFolder.values()].some((m) => [...m.values()].some((e) => e.length));
    if (!any) warnings.push("All included units are already marked printed in checkoff.");
  }

  const fileCounts: Record<string, number> = Object.fromEntries(order.map((r) => [r, 0]));

  for (const role of order) {
    const folders = byRoleFolder.get(role);
    if (!folders) continue;
    for (const [folder, entries] of [...folders.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      const folderDir = join(outputRoot, role, safeFolderName(folder));
      mkdirSync(folderDir, { recursive: true });
      const usedNames = new Set<string>();
      for (const [part, unit] of entries) {
        if (!part.absolutePath) continue;
        const entry = entryName(part, unit, usedNames);
        copyFileSync(part.absolutePath, join(folderDir, entry));
        fileCounts[role] = (fileCounts[role] ?? 0) + 1;
      }
    }
  }

  const resultCounts = Object.fromEntries(
    Object.entries(fileCounts).filter(([, v]) => v > 0),
  );
  return { rootPath: outputRoot, fileCounts: resultCounts, warnings };
}
