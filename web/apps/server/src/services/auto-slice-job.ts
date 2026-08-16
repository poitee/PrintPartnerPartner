/**
 * Auto-slice job: export a plan's plates as 3MF, send each plate to the
 * appropriate slicer sidecar, collect gcode + thumbnails.
 *
 * Slicer routing (per printer integration type):
 *   moonraker  -> slicer_sidecar with slicer="orca"   (OrcaSlicer)
 *   prusalink  -> slicer_sidecar with slicer="prusa"  (PrusaSlicer)
 *   bambu      -> slicer_sidecar with slicer="bambu"  (BambuStudio)
 *   (unbound)  -> slicer_sidecar with slicer="orca"   (fallback)
 *
 * For each printer the job finds the first matching slicer_sidecar integration
 * whose `slicer` field matches, then POSTs the plate 3MF (with resolved
 * slicer configs from the DB) to the sidecar `/slice` endpoint.
 *
 * Outputs are saved under:
 *   <exportsDir>/<planSlug>/gcode/<printerSlug>_plate_NN.gcode
 *   <exportsDir>/<planSlug>/gcode/thumbnails/plate_NN.png
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { JobSnapshot } from "@print-partner/contracts";
import type { AppRepository } from "../db/repository.js";
import { runExport3mfJob } from "./export-3mf-job.js";
import { loadFleet } from "./printer-fleet.js";
import { loadKitPrintPlan } from "./print-plan-store.js";
import { listIntegrationsByType, getIntegrationConfig } from "../integrations/store.js";
import { slicerSidecarSlice, type SlicerKind } from "../integrations/adapters/slicer-sidecar.js";
import { safePlanSlug } from "@print-partner/domain";

export type AutoSliceJobOptions = {
  profile_id: number;
  layout_mode?: string;
  spacing_mm?: number;
  missing_only?: boolean;
  enabled_printer_ids?: string[];
};

export type AutoSlicePlateResult = {
  printer_id: string;
  printer_name: string;
  plate_index: number;
  gcode_path: string;
  thumbnail_path: string | null;
  slicer: SlicerKind;
};

export type AutoSliceJobResult = {
  profile_id: number;
  plates: AutoSlicePlateResult[];
  warnings: string[];
  plate_count: number;
  gcode_paths: string[];
};

/** Infer which slicer type to use for a printer based on its linked integration. */
function inferSlicerKind(repo: AppRepository, integrationId: string | null | undefined): SlicerKind {
  if (!integrationId) return "orca";
  const integ = getIntegrationConfig(repo, integrationId);
  if (!integ) return "orca";
  if (integ.type === "prusalink") return "prusa";
  if (integ.type === "bambu") return "bambu";
  return "orca"; // moonraker + anything else -> OrcaSlicer
}

/** Find the best-matching slicer_sidecar integration for a given slicer kind. */
function resolveSidecarConfig(
  repo: AppRepository,
  slicerKind: SlicerKind,
): { id: string; config: Record<string, unknown> } | null {
  const sidecars = listIntegrationsByType(repo, "slicer_sidecar");
  // Prefer one that explicitly names the right slicer; fall back to first available.
  const match =
    sidecars.find((s) => String(s.config.slicer ?? "orca") === slicerKind) ??
    sidecars[0] ??
    null;
  if (!match) return null;
  return { id: match.id, config: match.config as Record<string, unknown> };
}

/** Load resolved flat config JSON for a slicer profile row (printer/process/filament). */
function loadResolvedConfig(resolvedFlatConfig: string | null): Record<string, unknown> {
  if (!resolvedFlatConfig) return {};
  try {
    return JSON.parse(resolvedFlatConfig) as Record<string, unknown>;
  } catch {
    return {};
  }
}

export async function runAutoSliceJob(
  repo: AppRepository,
  exportsDir: string,
  options: AutoSliceJobOptions,
  emit: (patch: Partial<JobSnapshot>) => void,
): Promise<AutoSliceJobResult> {
  const { profile_id } = options;
  const warnings: string[] = [];

  // Step 1: Export 3MF plates
  emit({ message: "Exporting plate 3MF files…", progress: 10 });
  let export3mfResult: ReturnType<typeof runExport3mfJob>;
  try {
    export3mfResult = runExport3mfJob(repo, profile_id, exportsDir, {
      layout_mode: options.layout_mode ?? "per_plate",
      spacing_mm: options.spacing_mm,
      missing_only: options.missing_only,
      enabled_printer_ids: options.enabled_printer_ids,
    });
  } catch (e) {
    throw new Error(`3MF export failed: ${e instanceof Error ? e.message : String(e)}`);
  }
  warnings.push(...export3mfResult.warnings);

  const platePaths = export3mfResult.paths;
  if (!platePaths.length) {
    return {
      profile_id,
      plates: [],
      warnings: [...warnings, "No plate files were exported."],
      plate_count: 0,
      gcode_paths: [],
    };
  }

  // Load fleet to identify printers
  const fleet = loadFleet(repo);
  const plan = loadKitPrintPlan(repo, profile_id);
  const { name: profileName } = repo.buildMergePartsForProfile(profile_id);
  const profileSlug = safePlanSlug(profileName);

  // Output directory for gcode
  const gcodeDir = join(exportsDir, profileSlug, "gcode");
  const thumbDir = join(gcodeDir, "thumbnails");
  mkdirSync(gcodeDir, { recursive: true });
  mkdirSync(thumbDir, { recursive: true });

  const results: AutoSlicePlateResult[] = [];
  const gcodePaths: string[] = [];
  const total = platePaths.length;

  for (let i = 0; i < platePaths.length; i++) {
    const platePath = platePaths[i]!;
    emit({
      message: `Slicing plate ${i + 1} of ${total}…`,
      progress: Math.round(10 + ((i / total) * 80)),
    });

    // Determine which printer this plate belongs to by matching the filename pattern.
    // Plate filenames: <profile>_<printer>_plate_NN.3mf or <profile>_<printer>_<group>_pNN.3mf
    const plateBasename = platePath.split("/").pop() ?? platePath;
    const plateIndex = i + 1;

    // Try to match a printer from the fleet by name slug in the filename.
    let matchedPrinter = fleet.find((m) => {
      const slug = safePlanSlug(m.name);
      return plateBasename.includes(`_${slug}_`);
    });
    if (!matchedPrinter) matchedPrinter = fleet[0]; // fallback to first

    const slicerKind = inferSlicerKind(repo, matchedPrinter?.integration_id);
    const sidecarCfg = resolveSidecarConfig(repo, slicerKind);

    if (!sidecarCfg) {
      const msg = `No slicer_sidecar integration configured for slicer="${slicerKind}" (plate ${plateIndex}). Skipping.`;
      warnings.push(msg);
      continue;
    }

    // Load 3MF bytes
    let modelBytes: Uint8Array;
    try {
      modelBytes = new Uint8Array(readFileSync(platePath));
    } catch (e) {
      warnings.push(`Could not read plate file ${platePath}: ${e instanceof Error ? e.message : String(e)}`);
      continue;
    }

    // Resolve slicer profile configs from the plan settings (resolved_flat_config JSON).
    // The plan may store slicer profile IDs; we attempt to load them from the DB settings.
    const machineConfig = loadPlanMachineConfig(repo, plan, matchedPrinter?.id ?? "");
    const processConfig = loadPlanProcessConfig(repo, plan, matchedPrinter?.id ?? "");
    const filamentConfigs = loadPlanFilamentConfigs(repo, plan, matchedPrinter?.id ?? "");

    // Call sidecar
    let sliceResult: Awaited<ReturnType<typeof slicerSidecarSlice>>;
    try {
      sliceResult = await slicerSidecarSlice(sidecarCfg.config, {
        model: modelBytes,
        machine_config: machineConfig,
        process_config: processConfig,
        filament_configs: filamentConfigs,
      });
    } catch (e) {
      warnings.push(
        `Slicing plate ${plateIndex} failed (${slicerKind} sidecar): ${e instanceof Error ? e.message : String(e)}`,
      );
      continue;
    }

    // Save gcode
    const gcodeExt = slicerKind === "bambu" ? ".bgcode" : ".gcode";
    const printerSlug = matchedPrinter ? safePlanSlug(matchedPrinter.name) : "printer";
    const gcodeName = `${profileSlug}_${printerSlug}_plate_${String(plateIndex).padStart(2, "0")}${gcodeExt}`;
    const gcodePath = join(gcodeDir, gcodeName);
    writeFileSync(gcodePath, sliceResult.gcode);
    gcodePaths.push(gcodePath);

    // Save thumbnail if present
    let thumbnailPath: string | null = null;
    if (sliceResult.thumbnail.length > 0) {
      const thumbName = `plate_${String(plateIndex).padStart(2, "0")}.png`;
      thumbnailPath = join(thumbDir, thumbName);
      writeFileSync(thumbnailPath, sliceResult.thumbnail);
    }

    results.push({
      printer_id: matchedPrinter?.id ?? "",
      printer_name: matchedPrinter?.name ?? "Unknown",
      plate_index: plateIndex,
      gcode_path: gcodePath,
      thumbnail_path: thumbnailPath,
      slicer: slicerKind,
    });
  }

  emit({ message: "Slicing complete", progress: 95 });

  return {
    profile_id,
    plates: results,
    warnings,
    plate_count: results.length,
    gcode_paths: gcodePaths,
  };
}

// ---------------------------------------------------------------------------
// Helpers: load slicer profile configs from the plan settings in the DB.
// The plan may store slicer_printer_profile_id, slicer_process_profile_id,
// and slicer_filament_profile_ids. We look these up and return their
// resolved_flat_config as parsed JSON.
// ---------------------------------------------------------------------------

type PrintPlan = ReturnType<typeof loadKitPrintPlan>;

function loadPlanMachineConfig(
  repo: AppRepository,
  plan: PrintPlan,
  _printerId: string,
): Record<string, unknown> | undefined {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pid = (plan as any).slicer_printer_profile_id as number | undefined;
  if (!pid) return undefined;
  try {
    const raw = repo.getSetting(`slicer_printer_profile_${pid}`);
    if (!raw) return undefined;
    const row = JSON.parse(raw) as { resolved_flat_config?: string | null };
    return loadResolvedConfig(row.resolved_flat_config ?? null);
  } catch {
    return undefined;
  }
}

function loadPlanProcessConfig(
  repo: AppRepository,
  plan: PrintPlan,
  _printerId: string,
): Record<string, unknown> | undefined {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pid = (plan as any).slicer_process_profile_id as number | undefined;
  if (!pid) return undefined;
  try {
    const raw = repo.getSetting(`slicer_process_profile_${pid}`);
    if (!raw) return undefined;
    const row = JSON.parse(raw) as { resolved_flat_config?: string | null };
    return loadResolvedConfig(row.resolved_flat_config ?? null);
  } catch {
    return undefined;
  }
}

function loadPlanFilamentConfigs(
  repo: AppRepository,
  plan: PrintPlan,
  _printerId: string,
): Array<Record<string, unknown>> | undefined {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pids = (plan as any).slicer_filament_profile_ids as number[] | undefined;
  if (!pids?.length) return undefined;
  const configs: Array<Record<string, unknown>> = [];
  for (const pid of pids) {
    try {
      const raw = repo.getSetting(`slicer_filament_profile_${pid}`);
      if (!raw) continue;
      const row = JSON.parse(raw) as { resolved_flat_config?: string | null };
      configs.push(loadResolvedConfig(row.resolved_flat_config ?? null));
    } catch {
      /* skip */
    }
  }
  return configs.length ? configs : undefined;
}
