/**
 * Per-printer slicer routing + settings resolution for the auto-slice flow.
 *
 * Routing rules (task t_669b3c7a):
 *   Klipper printers (moonraker integration) -> OrcaSlicer   ("orca")
 *   PrusaXL          (prusalink integration) -> PrusaSlicer  ("prusa")
 *   Bambu            (bambu integration)     -> BambuStudio  ("bambu")
 *
 * A printer that isn't bound to an integration host still needs a slicer, so
 * we fall back to matching the printer's display name ("Prusa XL" -> prusa,
 * "Bambu P1S" -> bambu, anything else -> orca, which is also the documented
 * default for Klipper/Voron machines).
 *
 * The sidecar wants PP's inheritance-resolved slicer configs as its settings
 * files, keyed by role: {machine, process, filament, filament_2, ...}. Those
 * live in the printer_profiles / process_profiles / filament_profiles tables
 * as `resolved_flat_config` JSON text.
 */

import type { PrinterMachine } from "@print-partner/domain";
import type { AppRepository, SlicerProfileRow } from "../db/repository.js";
import { getIntegrationConfig } from "../integrations/store.js";
import type { SlicerKind } from "../integrations/adapters/slicer-sidecar.js";

/** Flat, already inheritance-resolved config document. */
export type FlatConfig = Record<string, unknown>;

/** Named settings docs, exactly the shape the sidecar's `resolved_flat_configs` field takes. */
export type ResolvedFlatConfigs = Record<string, FlatConfig>;

export type SlicerSelection = {
  slicer: SlicerKind;
  /** How the slicer was chosen — surfaced in job warnings for debuggability. */
  reason: "override" | "integration" | "printer_name" | "default";
};

/**
 * Slicer format strings as they appear in the imported profile rows, grouped
 * by the slicer that can consume them. OrcaSlicer and BambuStudio share the
 * JSON profile lineage; PrusaSlicer uses its own INI dialect. `pp_native` is
 * PP's own bundled starter format and is portable across all three.
 */
const FORMATS_BY_SLICER: Record<SlicerKind, string[]> = {
  orca: ["orca", "orcaslicer", "bambu", "bambustudio", "pp_native"],
  bambu: ["bambu", "bambustudio", "orca", "orcaslicer", "pp_native"],
  prusa: ["prusa", "prusaslicer", "pp_native"],
};

const PORTABLE_FORMAT = "pp_native";

/**
 * Choose the slicer for a printer.
 *
 * Precedence: an explicit `preferred_slicer` override always wins (user
 * chose it deliberately in Settings); otherwise integration binding wins;
 * name is the last-resort fallback.
 */
export function selectSlicerForPrinter(
  repo: AppRepository,
  printer: PrinterMachine | null | undefined,
): SlicerSelection {
  const override = printer?.preferred_slicer;
  if (override === "orca" || override === "prusa" || override === "bambu") {
    return { slicer: override, reason: "override" };
  }

  const integrationId = printer?.integration_id;
  if (integrationId) {
    const integ = getIntegrationConfig(repo, integrationId);
    if (integ) {
      if (integ.type === "prusalink") return { slicer: "prusa", reason: "integration" };
      if (integ.type === "bambu") return { slicer: "bambu", reason: "integration" };
      if (integ.type === "moonraker") return { slicer: "orca", reason: "integration" };
    }
  }

  const name = (printer?.name ?? "").toLowerCase();
  if (name) {
    if (name.includes("bambu") || /\b[xpah]1\b/.test(name)) {
      return { slicer: "bambu", reason: "printer_name" };
    }
    if (name.includes("prusa") || /\bmk[234]\b/.test(name) || /\bxl\b/.test(name)) {
      return { slicer: "prusa", reason: "printer_name" };
    }
  }
  // Klipper/Voron and everything else slice with OrcaSlicer.
  return { slicer: "orca", reason: "default" };
}

function parseFlatConfig(raw: string | null | undefined): FlatConfig | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return parsed as FlatConfig;
  } catch {
    return null;
  }
}

function normalizeFormat(value: string | null | undefined): string {
  return (value ?? "").toLowerCase().replace(/[\s_-]/g, "");
}

/**
 * True when a profile row's slicer_format is usable by `slicer`.
 *
 * A null/blank format means the row carries no slicer dialect tag at all —
 * that's the case for every `filament_profiles` row, which has no
 * slicer_format column — so those rows are treated as portable rather than
 * being filtered out (which would mean no filament doc ever reached the
 * sidecar, and OrcaSlicer needs one to slice headlessly).
 */
export function profileMatchesSlicer(row: SlicerProfileRow, slicer: SlicerKind): boolean {
  const fmt = normalizeFormat(row.slicerFormat);
  if (!fmt) return true;
  return FORMATS_BY_SLICER[slicer].some((accepted) => fmt.includes(normalizeFormat(accepted)));
}

/**
 * How well a row's format fits `slicer`, lower is better:
 *   0..n  index into FORMATS_BY_SLICER (the slicer's own dialect scores 0,
 *         a sibling dialect it can still read scores higher)
 *   99    portable pp_native / untagged fallback
 *
 * Ranking (rather than a plain boolean) matters because OrcaSlicer can read
 * BambuStudio profiles and vice versa — without it, an "Imported Bambu 0.2"
 * row could out-sort the "Imported Orca 0.2" row for an Orca plate purely on
 * alphabetical order.
 */
function formatRank(row: SlicerProfileRow, slicer: SlicerKind): number {
  const fmt = normalizeFormat(row.slicerFormat);
  if (!fmt || fmt.includes(normalizeFormat(PORTABLE_FORMAT))) return 99;
  const accepted = FORMATS_BY_SLICER[slicer];
  for (let i = 0; i < accepted.length; i++) {
    if (accepted[i] === PORTABLE_FORMAT) continue;
    if (fmt.includes(normalizeFormat(accepted[i]!))) return i;
  }
  return 99;
}

/**
 * Pick the best profile row for a printer. Rows are ranked by:
 *   1. name match (case-insensitive, bidirectional so "Voron 350" matches
 *      "Voron 350 0.4 nozzle")
 *   2. format affinity — the slicer's own dialect, then a readable sibling
 *      dialect, then portable pp_native starters
 *   3. original list order (name-sorted) as a stable tiebreak
 */
export function pickProfileForPrinter(
  rows: SlicerProfileRow[],
  slicer: SlicerKind,
  printerName: string | null | undefined,
): SlicerProfileRow | null {
  return pickProfileForPrinterDetailed(rows, slicer, printerName).row;
}

/** Same as `pickProfileForPrinter`, but also reports whether the name matched. */
export function pickProfileForPrinterDetailed(
  rows: SlicerProfileRow[],
  slicer: SlicerKind,
  printerName: string | null | undefined,
): { row: SlicerProfileRow | null; nameMatched: boolean } {
  const compatible = rows.filter((r) => profileMatchesSlicer(r, slicer) && r.resolvedFlatConfig);
  if (!compatible.length) return { row: null, nameMatched: false };

  const target = (printerName ?? "").trim().toLowerCase();
  const matchesName = (r: SlicerProfileRow): boolean => {
    if (!target) return false;
    const name = r.name.trim().toLowerCase();
    return name === target || name.includes(target) || target.includes(name);
  };

  let best = compatible[0]!;
  let bestScore: [number, number] = [matchesName(best) ? 0 : 1, formatRank(best, slicer)];
  for (const row of compatible.slice(1)) {
    const score: [number, number] = [matchesName(row) ? 0 : 1, formatRank(row, slicer)];
    if (score[0] < bestScore[0] || (score[0] === bestScore[0] && score[1] < bestScore[1])) {
      best = row;
      bestScore = score;
    }
  }
  return { row: best, nameMatched: bestScore[0] === 0 };
}

export type ResolveSettingsResult = {
  configs: ResolvedFlatConfigs;
  warnings: string[];
  /** Which profile row supplied each entry, for job metadata/logging. */
  sources: Record<string, { id: number; name: string }>;
};

/**
 * Build the sidecar's `resolved_flat_configs` payload for one printer.
 *
 * Keys are meaningful to the sidecar's settings writer: "machine" and
 * "process" go to --load-settings, anything whose key contains "filament"
 * goes to --load-filaments (see slicer_sidecar/settings_writer.py).
 */
export function resolveFlatConfigsForPrinter(
  repo: AppRepository,
  printer: PrinterMachine | null | undefined,
  slicer: SlicerKind,
): ResolveSettingsResult {
  const configs: ResolvedFlatConfigs = {};
  const sources: Record<string, { id: number; name: string }> = {};
  const warnings: string[] = [];
  const printerName = printer?.name ?? null;

  const machinePick = pickProfileForPrinterDetailed(
    repo.listSlicerPrinterProfiles(),
    slicer,
    printerName,
  );
  const machineRow = machinePick.row;
  if (machineRow) {
    const cfg = parseFlatConfig(machineRow.resolvedFlatConfig);
    if (cfg) {
      configs.machine = cfg;
      sources.machine = { id: machineRow.id, name: machineRow.name };
      if (!machinePick.nameMatched && printerName) {
        // Silently slicing a Voron with a Bambu bed profile would produce
        // plausible-looking but wrong gcode, so say which profile was used.
        warnings.push(
          `No printer profile named like "${printerName}"; used "${machineRow.name}" instead.`,
        );
      }
    } else {
      warnings.push(`Printer profile "${machineRow.name}" has an unreadable resolved config.`);
    }
  } else {
    warnings.push(
      `No ${slicer}-compatible printer profile found${printerName ? ` for ${printerName}` : ""}; ` +
        "the sidecar will fall back to its bundled machine settings.",
    );
  }

  const processRow = pickProfileForPrinter(repo.listSlicerProcessProfiles(), slicer, printerName);
  if (processRow) {
    const cfg = parseFlatConfig(processRow.resolvedFlatConfig);
    if (cfg) {
      configs.process = cfg;
      sources.process = { id: processRow.id, name: processRow.name };
    } else {
      warnings.push(`Process profile "${processRow.name}" has an unreadable resolved config.`);
    }
  } else {
    warnings.push(`No ${slicer}-compatible process profile found; using slicer defaults.`);
  }

  // One filament doc per loaded slot so multi-material printers pass every
  // filament the plate can reference. Slot labels are matched against the
  // filament profile names; unlabeled slots take the first compatible row.
  const filamentRows = repo.listSlicerFilamentProfiles();
  const slots = printer?.loaded_filaments ?? [];
  let filamentIndex = 0;
  for (const slot of slots) {
    const row = pickProfileForPrinter(filamentRows, slicer, slot.label || null);
    if (!row) continue;
    const cfg = parseFlatConfig(row.resolvedFlatConfig);
    if (!cfg) continue;
    const key = filamentIndex === 0 ? "filament" : `filament_${filamentIndex + 1}`;
    configs[key] = withMaterialType(cfg, row);
    sources[key] = { id: row.id, name: row.name };
    filamentIndex += 1;
  }
  if (filamentIndex === 0) {
    const row = pickProfileForPrinter(filamentRows, slicer, null);
    const cfg = row ? parseFlatConfig(row.resolvedFlatConfig) : null;
    if (row && cfg) {
      configs.filament = withMaterialType(cfg, row);
      sources.filament = { id: row.id, name: row.name };
    } else {
      warnings.push(`No ${slicer}-compatible filament profile found; using slicer defaults.`);
    }
  }

  return { configs, warnings, sources };
}

/**
 * Ensure a filament config carries its material type.
 *
 * Every slicer requires a filament type (OrcaSlicer/BambuStudio
 * `filament_type`, PrusaSlicer `filament_type`) and rejects a preset that
 * omits it, but PP stores material on the `filament_profiles.material_type`
 * column rather than inside `resolved_flat_config`. Fold that column back into
 * the config when the flat doc doesn't already specify it.
 */
function withMaterialType(cfg: FlatConfig, row: SlicerProfileRow): FlatConfig {
  if (cfg.material_type || cfg.filament_type) return cfg;
  const material = (row.materialType ?? "").trim();
  if (!material) return cfg;
  return { ...cfg, material_type: material };
}
