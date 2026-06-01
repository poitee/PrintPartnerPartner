import { accessSync } from "node:fs";
import { join } from "node:path";
import { folderKeyFromRelativePath, ROOT_FOLDER } from "@print-partner/domain";
import { getColorById } from "./filament-catalog.js";
import type { AppRepository } from "../db/repository.js";
import type { PartDbRow } from "../db/repository.js";

export type PlanReviewIssue = {
  severity: "blocker" | "warning";
  code: string;
  message: string;
  link_hint?: string;
};

export type PlanReviewOptions = {
  includeExcluded?: boolean;
};

function filamentLabel(part: {
  filament_color_id: string | null;
  filament_display?: string;
  filament_custom_hex?: string | null;
}): string {
  if (part.filament_display?.trim()) return part.filament_display.trim();
  const fid = (part.filament_color_id ?? "").trim();
  if (fid) {
    const color = getColorById(fid);
    if (color) return color.combo_label;
    return fid;
  }
  return "Unassigned";
}

function stlExists(localRoot: string, relativePath: string): boolean {
  const rel = (relativePath || "").trim().replace(/^\/+/, "");
  if (!rel) return false;
  try {
    accessSync(join(localRoot, rel));
    return true;
  } catch {
    return false;
  }
}

function resolveLayerRoot(
  part: PartDbRow,
  layers: ReturnType<AppRepository["getProfileLayers"]>,
  projectByLayer: Map<number, ReturnType<AppRepository["getProjectRow"]>>,
): string | null {
  for (const layer of layers) {
    const proj = projectByLayer.get(layer.id);
    if (!proj?.localPath) continue;
    const label = `${layer.layer_type}:${proj.name}`;
    if (part.sourceLayer === label || part.sourceLayer.startsWith(label)) {
      return proj.localPath;
    }
  }
  for (const layer of layers) {
    const proj = projectByLayer.get(layer.id);
    if (proj?.localPath) return proj.localPath;
  }
  return null;
}

export function buildPlanReview(
  repo: AppRepository,
  profileId: number,
  options: PlanReviewOptions = {},
) {
  const includeExcluded = options.includeExcluded ?? false;
  const profile = repo.getProfile(profileId);
  if (!profile) throw new Error("Profile not found");

  const layers = repo.getProfileLayers(profileId);
  const { parts } = repo.listParts(profileId, 10000, 0);
  const included = parts.filter((p) => p.included);
  const enrichedParts = repo.getEnrichedPartsForReview(profileId, includeExcluded);

  const projectByLayer = new Map<number, ReturnType<AppRepository["getProjectRow"]>>();
  const layerPayload = layers.map((layer) => {
    const proj = layer.project_id ? repo.getProjectRow(layer.project_id) : null;
    projectByLayer.set(layer.id, proj);
    const localPath = proj?.localPath?.trim() ?? "";
    let synced = false;
    if (localPath) {
      try {
        accessSync(localPath);
        synced = true;
      } catch {
        synced = false;
      }
    }
    return {
      id: layer.id,
      layer_type: layer.layer_type,
      project_id: layer.project_id,
      project_name: layer.project_name,
      local_path: localPath || null,
      synced,
      last_synced_at: proj?.lastSyncedAt ?? null,
    };
  });

  const byRole: Record<string, number> = {};
  const byFilament: Record<string, number> = {};
  let printUnits = 0;
  for (const part of enrichedParts.filter((p) => p.included)) {
    byRole[part.role || "primary"] = (byRole[part.role || "primary"] ?? 0) + 1;
    byFilament[filamentLabel(part)] =
      (byFilament[filamentLabel(part)] ?? 0) + Math.max(1, part.quantity_effective);
    printUnits += Math.max(1, part.quantity_effective);
  }

  const issues: PlanReviewIssue[] = [];

  for (const layer of layers) {
    const proj = layer.project_id ? repo.getProjectRow(layer.project_id) : null;
    if (layer.project_id == null) {
      issues.push({
        severity: "blocker",
        code: "layer_no_project",
        message: `${layer.layer_type.charAt(0).toUpperCase()}${layer.layer_type.slice(1)} layer has no source attached.`,
        link_hint: "build",
      });
      continue;
    }
    if (!proj) continue;
    const localPath = (proj.localPath ?? "").trim();
    let synced = false;
    if (localPath) {
      try {
        accessSync(localPath);
        synced = true;
      } catch {
        synced = false;
      }
    }
    if (!synced) {
      const label = proj.name || proj.url || "source";
      issues.push({
        severity: "blocker",
        code: "unsynced_source",
        message: `Source "${label}" is not synced to a local folder.`,
        link_hint: "sources",
      });
    }
  }

  if (!included.length) {
    issues.push({
      severity: "blocker",
      code: "no_included_parts",
      message: "No parts are included in this build.",
      link_hint: "build",
    });
  }

  for (const part of included) {
    const row = repo.getPartRow(part.id);
    if (!row) continue;
    const root = resolveLayerRoot(row, layers, projectByLayer);
    if (!root) continue;
    if (!stlExists(root, row.relativePath || row.filename)) {
      issues.push({
        severity: "blocker",
        code: "missing_stl",
        message: `STL not found on disk: ${row.filename}`,
        link_hint: "sources",
      });
    }
  }

  for (const part of parts) {
    if (part.status === "conflict") {
      issues.push({
        severity: "warning",
        code: "merge_conflict",
        message: `Merge conflict for ${part.filename} — verify selection.`,
        link_hint: "build",
      });
    }
  }

  const grouped = new Map<string, typeof enrichedParts>();
  const sourceByFolder = new Map<string, string | null>();
  for (const part of enrichedParts) {
    const folder = folderKeyFromRelativePath(part.relative_path || part.filename);
    if (!grouped.has(folder)) grouped.set(folder, []);
    grouped.get(folder)!.push(part);
    if (!sourceByFolder.has(folder)) sourceByFolder.set(folder, part.source_layer);
  }

  const folderKeys = [...grouped.keys()].sort((a, b) => {
    if (a === ROOT_FOLDER) return -1;
    if (b === ROOT_FOLDER) return 1;
    return a.localeCompare(b);
  });

  const part_groups = folderKeys.map((key) => ({
    folder: key,
    source_layer: sourceByFolder.get(key) ?? null,
    parts: grouped.get(key) ?? [],
  }));

  const has_blockers = issues.some((i) => i.severity === "blocker");

  return {
    profile_id: profileId,
    plan_name: profile.name,
    layers: layerPayload,
    totals: {
      included_parts: included.length,
      total_print_units: printUnits,
      by_role: byRole,
      by_filament: byFilament,
    },
    issues,
    has_blockers,
    part_groups,
  };
}
