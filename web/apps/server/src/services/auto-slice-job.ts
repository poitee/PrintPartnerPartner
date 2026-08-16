/**
 * Auto-slice job: export a plan's plates as 3MF, send each plate to the
 * appropriate slicer sidecar, collect gcode + thumbnails.
 *
 * Slicer routing (see services/slicer-routing.ts for the full rules):
 *   Klipper (moonraker) -> slicer_sidecar with slicer="orca"   (OrcaSlicer)
 *   PrusaXL (prusalink) -> slicer_sidecar with slicer="prusa"  (PrusaSlicer)
 *   Bambu   (bambu)     -> slicer_sidecar with slicer="bambu"  (BambuStudio)
 *
 * For each printer the job finds the first matching slicer_sidecar integration
 * whose `slicer` field matches, then POSTs the plate 3MF plus the printer's
 * resolved_flat_configs (machine/process/filament docs pulled from PP's
 * imported slicer profile tables) to the sidecar.
 *
 * Outputs are saved under:
 *   <exportsDir>/<planSlug>/gcode/<plan>_<printerSlug>_plate_NN.gcode
 *   <exportsDir>/<planSlug>/gcode/thumbnails/plate_NN.png
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import type { JobSnapshot } from "@print-partner/contracts";
import type { AppRepository } from "../db/repository.js";
import { runExport3mfJob } from "./export-3mf-job.js";
import { loadFleet } from "./printer-fleet.js";
import { listIntegrationsByType } from "../integrations/store.js";
import {
  slicerSidecarSlice,
  SlicerSidecarError,
  type SlicerKind,
} from "../integrations/adapters/slicer-sidecar.js";
import {
  resolveFlatConfigsForPrinter,
  selectSlicerForPrinter,
  type ResolvedFlatConfigs,
} from "./slicer-routing.js";
import { safePlanSlug } from "@print-partner/domain";

export type AutoSliceJobOptions = {
  profile_id: number;
  layout_mode?: string;
  spacing_mm?: number;
  missing_only?: boolean;
  enabled_printer_ids?: string[];
  /** Per-plate slice timeout handed to the sidecar (seconds). */
  timeout_s?: number;
};

export type AutoSlicePlateResult = {
  printer_id: string;
  printer_name: string;
  plate_index: number;
  plate_path: string;
  slicer: SlicerKind;
  status: "ok" | "error";
  gcode_path: string | null;
  thumbnail_path: string | null;
  /** Human-readable failure reason when status === "error". */
  error: string | null;
  /** Structured sidecar error code when available (e.g. slicer_timeout). */
  error_code: string | null;
  /** Which resolved_flat_configs keys were sent (machine/process/filament…). */
  settings_keys: string[];
};

export type AutoSliceJobResult = {
  profile_id: number;
  plates: AutoSlicePlateResult[];
  warnings: string[];
  /** Plates that produced gcode. */
  plate_count: number;
  /** Plates attempted (ok + error). */
  attempted_count: number;
  failed_count: number;
  gcode_paths: string[];
  /** True when every attempted plate sliced successfully and at least one did. */
  ok: boolean;
};

/** Find the best-matching slicer_sidecar integration for a given slicer kind. */
function resolveSidecarConfig(
  repo: AppRepository,
  slicerKind: SlicerKind,
): { id: string; name: string; config: Record<string, unknown> } | null {
  const sidecars = listIntegrationsByType(repo, "slicer_sidecar");
  // Only accept a sidecar that actually runs the requested slicer. Falling
  // back to "any sidecar" would silently slice a PrusaXL plate on OrcaSlicer,
  // which is exactly the mis-routing this job exists to prevent — an explicit
  // warning is better than a wrong-slicer gcode file.
  const match = sidecars.find((s) => String(s.config.slicer ?? "orca") === slicerKind) ?? null;
  if (!match) return null;
  return { id: match.id, name: match.name, config: match.config as Record<string, unknown> };
}

/** Parse `<plan>_<printer>_plate_NN.3mf` / `<plan>_<printer>_<group>_pNN.3mf`. */
function plateIndexFromFilename(filename: string, fallback: number): number {
  const m = /_(?:plate_|p)(\d+)\.3mf$/i.exec(filename);
  if (!m) return fallback;
  const n = Number(m[1]);
  return Number.isFinite(n) && n > 0 ? n : fallback;
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
      // Auto-slice always wants one file per plate; a zipped export would give
      // the sidecar an archive it cannot slice.
      layout_mode: "per_plate",
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
      attempted_count: 0,
      failed_count: 0,
      gcode_paths: [],
      ok: false,
    };
  }

  // Load fleet to identify printers
  const fleet = loadFleet(repo);
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
  // Settings resolution is per printer, not per plate — cache it so a 12-plate
  // job doesn't re-read the profile tables twelve times.
  const settingsCache = new Map<string, { configs: ResolvedFlatConfigs; keys: string[] }>();

  for (let i = 0; i < platePaths.length; i++) {
    const platePath = platePaths[i]!;
    emit({
      message: `Slicing plate ${i + 1} of ${total}…`,
      progress: Math.round(10 + (i / total) * 80),
    });

    const plateBasename = basename(platePath);
    const plateIndex = plateIndexFromFilename(plateBasename, i + 1);

    // Match a printer from the fleet by name slug in the filename
    // (export-3mf names plates "<plan>_<printerSlug>_plate_NN.3mf").
    let matchedPrinter = fleet.find((m) => plateBasename.includes(`_${safePlanSlug(m.name)}_`));
    if (!matchedPrinter) matchedPrinter = fleet[0];

    const selection = selectSlicerForPrinter(repo, matchedPrinter);
    const slicerKind = selection.slicer;
    const printerSlug = matchedPrinter ? safePlanSlug(matchedPrinter.name) : "printer";
    const printerName = matchedPrinter?.name ?? "Unknown";

    const fail = (message: string, code: string | null, settingsKeys: string[] = []) => {
      warnings.push(`Plate ${plateIndex} (${printerName}, ${slicerKind}): ${message}`);
      results.push({
        printer_id: matchedPrinter?.id ?? "",
        printer_name: printerName,
        plate_index: plateIndex,
        plate_path: platePath,
        slicer: slicerKind,
        status: "error",
        gcode_path: null,
        thumbnail_path: null,
        error: message,
        error_code: code,
        settings_keys: settingsKeys,
      });
    };

    const sidecarCfg = resolveSidecarConfig(repo, slicerKind);
    if (!sidecarCfg) {
      fail(
        `No slicer_sidecar integration configured with slicer="${slicerKind}". ` +
          "Add one in Settings → Integrations.",
        "no_sidecar",
      );
      continue;
    }

    // Load 3MF bytes
    let modelBytes: Uint8Array;
    try {
      modelBytes = new Uint8Array(readFileSync(platePath));
    } catch (e) {
      fail(
        `Could not read plate file ${platePath}: ${e instanceof Error ? e.message : String(e)}`,
        "plate_read_failed",
      );
      continue;
    }

    // Resolve the printer's slicer settings (machine/process/filament docs).
    const cacheKey = `${matchedPrinter?.id ?? ""}:${slicerKind}`;
    let cached = settingsCache.get(cacheKey);
    if (!cached) {
      const resolved = resolveFlatConfigsForPrinter(repo, matchedPrinter, slicerKind);
      for (const w of resolved.warnings) warnings.push(`${printerName}: ${w}`);
      cached = { configs: resolved.configs, keys: Object.keys(resolved.configs) };
      settingsCache.set(cacheKey, cached);
    }

    if (!cached.keys.length) {
      fail(
        `No resolved slicer settings available for ${printerName}. ` +
          "Import printer/process/filament profiles for this slicer first.",
        "no_settings",
      );
      continue;
    }

    // Call sidecar
    let sliceResult: Awaited<ReturnType<typeof slicerSidecarSlice>>;
    try {
      sliceResult = await slicerSidecarSlice(sidecarCfg.config, {
        model: modelBytes,
        filename: plateBasename,
        slicer: slicerKind,
        resolved_flat_configs: cached.configs,
        ...(options.timeout_s != null ? { timeout_s: options.timeout_s } : {}),
      });
    } catch (e) {
      const code = e instanceof SlicerSidecarError ? e.code : "slice_failed";
      fail(e instanceof Error ? e.message : String(e), code, cached.keys);
      continue;
    }

    if (!sliceResult.gcode.length) {
      fail("Sidecar returned an empty gcode file.", "empty_gcode", cached.keys);
      continue;
    }
    for (const w of sliceResult.warnings ?? []) {
      warnings.push(`Plate ${plateIndex} (${printerName}): ${w}`);
    }

    // Save gcode. Prefer the sidecar's own extension (BambuStudio may emit
    // .bgcode, PrusaSlicer .gcode/.bgcode depending on the profile) so the
    // stored file matches what the firmware expects.
    const suggested = sliceResult.filename ?? "";
    const gcodeExt = suggested.toLowerCase().endsWith(".bgcode") ? ".bgcode" : ".gcode";
    const gcodeName = `${profileSlug}_${printerSlug}_plate_${String(plateIndex).padStart(2, "0")}${gcodeExt}`;
    const gcodePath = join(gcodeDir, gcodeName);
    writeFileSync(gcodePath, sliceResult.gcode);
    gcodePaths.push(gcodePath);

    // Save the plate_N.png thumbnail if the sidecar produced one.
    let thumbnailPath: string | null = null;
    if (sliceResult.thumbnail.length > 0) {
      const thumbName = `plate_${String(plateIndex).padStart(2, "0")}.png`;
      thumbnailPath = join(thumbDir, thumbName);
      writeFileSync(thumbnailPath, sliceResult.thumbnail);
    } else {
      warnings.push(`Plate ${plateIndex} (${printerName}): sidecar returned no thumbnail.`);
    }

    results.push({
      printer_id: matchedPrinter?.id ?? "",
      printer_name: printerName,
      plate_index: plateIndex,
      plate_path: platePath,
      slicer: slicerKind,
      status: "ok",
      gcode_path: gcodePath,
      thumbnail_path: thumbnailPath,
      error: null,
      error_code: null,
      settings_keys: cached.keys,
    });
  }

  const failed = results.filter((r) => r.status === "error");
  const succeeded = results.filter((r) => r.status === "ok");

  emit({
    message: failed.length
      ? `Sliced ${succeeded.length} of ${results.length} plates (${failed.length} failed)`
      : "Slicing complete",
    progress: 95,
  });

  return {
    profile_id,
    plates: results,
    warnings,
    plate_count: succeeded.length,
    attempted_count: results.length,
    failed_count: failed.length,
    gcode_paths: gcodePaths,
    ok: failed.length === 0 && succeeded.length > 0,
  };
}

/** User-facing job completion message for the auto-slice job. */
export function autoSliceJobMessage(result: {
  plate_count?: number;
  attempted_count?: number;
  failed_count?: number;
  warnings?: string[];
}): string {
  const sliced = result.plate_count ?? 0;
  const attempted = result.attempted_count ?? 0;
  const failed = result.failed_count ?? 0;
  const warnings = result.warnings ?? [];

  if (attempted === 0) {
    return warnings[0] ?? "No plates were sliced — export produced no plate files.";
  }
  if (sliced === 0) {
    return `All ${attempted} plate(s) failed to slice${warnings.length ? `: ${warnings[0]}` : ""}`;
  }
  if (failed > 0) {
    return `Sliced ${sliced} of ${attempted} plate(s) — ${failed} failed`;
  }
  return `Sliced ${sliced} plate(s)`;
}
