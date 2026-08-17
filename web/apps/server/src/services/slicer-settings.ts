/**
 * Slicer settings-file assembly for the auto-slice flow (task t_f21b1a05).
 *
 * `slicer-routing.ts` answers "which slicer, and which PP profile rows feed
 * it". This module answers the next question: "what exact files does that
 * slicer's CLI want on disk, and what do they have to contain".
 *
 * The public entry point is {@link resolveSlicerAndSettings}:
 *
 *     const { slicerType, settingsFiles } = resolveSlicerAndSettings(repo, printer);
 *
 * It returns both representations the rest of the pipeline needs:
 *   - `settingsFiles`         — real files written to a temp dir, each tagged
 *                               with the CLI flag it belongs to. This is what
 *                               a direct CLI invocation (or a debug dump)
 *                               consumes.
 *   - `resolvedFlatConfigs`   — the same documents as an in-memory dict, which
 *                               is the shape the HTTP sidecar's
 *                               `resolved_flat_configs` form field takes
 *                               (slicer_sidecar/settings_writer.py writes them
 *                               out again on the sidecar host).
 *
 * ---------------------------------------------------------------------------
 * Per-slicer settings formats
 * ---------------------------------------------------------------------------
 * OrcaSlicer (fully implemented, the acceptance target)
 *   One JSON document per role. machine + process go to `--load-settings`
 *   (semicolon-joined, machine first — order matters), filaments go to
 *   `--load-filaments`. Each document needs the profile envelope
 *   (`type`/`name`/`from`/`instantiation`); process and filament additionally
 *   need `compatible_printers` naming the machine or Orca may refuse the
 *   combination. Orca writes scalars as strings and per-extruder settings as
 *   arrays of strings, so we serialize the same way — a raw JSON number in a
 *   per-extruder field is a common cause of CLI exit -5/-51.
 *
 * BambuStudio (implemented, shares Orca's lineage)
 *   Same JSON schema and same flags: BambuStudio and OrcaSlicer share the
 *   profile format (Orca is a Bambu Studio fork and imports Bambu profiles
 *   natively). NOTE: the exact `from` provenance value BambuStudio accepts for
 *   an externally supplied preset was not verifiable against a real install in
 *   this environment; "User" is what Orca writes for user presets and is what
 *   we emit for both.
 *
 * PrusaSlicer (implemented, INI dialect)
 *   PrusaSlicer has no JSON profile format — profiles are flat INI
 *   (`key = value`, no section headers when loaded as a single config) and are
 *   passed as one repeated `--load <file.ini>` flag per file. Keys differ from
 *   Orca's (`perimeters` vs `wall_loops`, `temperature` vs
 *   `nozzle_temperature`, …), so PP-native configs are translated through the
 *   Prusa half of {@link PROCESS_KEY_MAP} / {@link FILAMENT_KEY_MAP} /
 *   {@link MACHINE_KEY_MAP}. NOTE: PrusaSlicer accepts a much larger key set
 *   than we translate; unmapped PP-native keys are dropped and reported as
 *   warnings rather than passed through, because an unknown key aborts
 *   PrusaSlicer's config load. One key is always emitted whether or not a
 *   profile supplies it — `thumbnails`, without which PrusaSlicer writes no
 *   embedded plate PNG and the sidecar cannot return a thumbnail at all
 *   (see {@link ensurePrusaThumbnails}).
 */

import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PrinterMachine } from "@print-partner/domain";
import type { AppRepository } from "../db/repository.js";
import type { SlicerKind } from "../integrations/adapters/slicer-sidecar.js";
import {
  resolveFlatConfigsForPrinter,
  selectSlicerForPrinter,
  type FlatConfig,
  type ResolvedFlatConfigs,
  type SlicerSelection,
} from "./slicer-routing.js";

export type { FlatConfig, ResolvedFlatConfigs };

/** Alias so callers can speak in the task's vocabulary ("slicerType"). */
export type SlicerType = SlicerKind;

/** Which slot in the slicer's settings model a document fills. */
export type SettingsRole = "machine" | "process" | "filament";

/** CLI flag a settings file is passed under. */
export type SettingsCliFlag = "--load-settings" | "--load-filaments" | "--load";

export type SettingsFile = {
  /** resolved_flat_configs key this file came from: machine/process/filament/filament_2/… */
  key: string;
  role: SettingsRole;
  filename: string;
  /** Absolute path of the written file. */
  path: string;
  cliFlag: SettingsCliFlag;
  /** Parsed document as written (JSON slicers only; null for INI). */
  document: FlatConfig | null;
};

export type ResolveSlicerAndSettingsResult = {
  slicerType: SlicerType;
  /** How the slicer was chosen — surfaced in job warnings for debuggability. */
  slicerReason: SlicerSelection["reason"];
  settingsFiles: SettingsFile[];
  /**
   * Slicer-shaped settings documents keyed exactly like `settingsFiles` — the
   * payload for the sidecar's `resolved_flat_configs` field.
   */
  resolvedFlatConfigs: ResolvedFlatConfigs;
  /** Directory the files were written into. */
  dir: string;
  /** Which PP profile row supplied each entry. */
  sources: Record<string, { id: number; name: string }>;
  warnings: string[];
  /** Remove the temp dir. No-op when the caller supplied their own `outDir`. */
  cleanup: () => void;
};

export type ResolveSlicerAndSettingsOptions = {
  /** Force a slicer instead of deriving it from the printer. */
  slicer?: SlicerType;
  /**
   * Pre-resolved PP configs, bypassing the repository lookup. Keys follow the
   * sidecar convention: "machine", "process", "filament", "filament_2", …
   */
  resolvedFlatConfigs?: ResolvedFlatConfigs;
  /**
   * Source dialect of `resolvedFlatConfigs`. "pp_native" (the default) runs
   * the key translation; "slicer_native" writes them through untouched, for
   * configs imported verbatim from the target slicer.
   */
  sourceFormat?: "pp_native" | "slicer_native";
  /** Write into this directory instead of a fresh mkdtemp dir. */
  outDir?: string;
};

// ---------------------------------------------------------------------------
// Key translation: PP-native / PrusaSlicer key names -> per-slicer key names.
// Mapping table follows the field survey in ~/slicer-profile-research.md §3.
// A `null` target means "intentionally dropped for this slicer".
// ---------------------------------------------------------------------------

type KeyMapEntry = {
  /** Target key(s) in OrcaSlicer/BambuStudio's JSON schema. */
  orca: string | string[] | null;
  /** Target key(s) in PrusaSlicer's INI schema. */
  prusa: string | string[] | null;
  /** Serialize as a one-element array (Orca per-extruder settings). */
  perExtruder?: boolean;
  /** Value is a ratio (0..1) or a plain number that Orca wants as "NN%". */
  percent?: boolean;
};

const MACHINE_KEY_MAP: Record<string, KeyMapEntry> = {
  nozzle_diameter_mm: { orca: "nozzle_diameter", prusa: "nozzle_diameter", perExtruder: true },
  nozzle_diameter: { orca: "nozzle_diameter", prusa: "nozzle_diameter", perExtruder: true },
  printable_area: { orca: "printable_area", prusa: "bed_shape" },
  bed_shape: { orca: "printable_area", prusa: "bed_shape" },
  printable_height_mm: { orca: "printable_height", prusa: "max_print_height" },
  gcode_flavor: { orca: "gcode_flavor", prusa: "gcode_flavor" },
  retraction_length_mm: { orca: "retraction_length", prusa: "retract_length", perExtruder: true },
  retract_length: { orca: "retraction_length", prusa: "retract_length", perExtruder: true },
  retraction_speed_mm_s: { orca: "retraction_speed", prusa: "retract_speed", perExtruder: true },
  retract_speed: { orca: "retraction_speed", prusa: "retract_speed", perExtruder: true },
  z_hop_mm: { orca: "z_hop", prusa: "retract_lift", perExtruder: true },
  retract_lift: { orca: "z_hop", prusa: "retract_lift", perExtruder: true },
  start_gcode: { orca: "machine_start_gcode", prusa: "start_gcode" },
  machine_start_gcode: { orca: "machine_start_gcode", prusa: "start_gcode" },
  end_gcode: { orca: "machine_end_gcode", prusa: "end_gcode" },
  machine_end_gcode: { orca: "machine_end_gcode", prusa: "end_gcode" },
  printer_model: { orca: "printer_model", prusa: "printer_model" },
  printer_variant: { orca: "printer_variant", prusa: "printer_variant" },
  extruder_count: { orca: null, prusa: null },
  description: { orca: null, prusa: null },
};

const PROCESS_KEY_MAP: Record<string, KeyMapEntry> = {
  layer_height: { orca: "layer_height", prusa: "layer_height" },
  first_layer_height: { orca: "initial_layer_print_height", prusa: "first_layer_height" },
  initial_layer_print_height: { orca: "initial_layer_print_height", prusa: "first_layer_height" },
  perimeters: { orca: "wall_loops", prusa: "perimeters" },
  wall_loops: { orca: "wall_loops", prusa: "perimeters" },
  top_solid_layers: { orca: "top_shell_layers", prusa: "top_solid_layers" },
  bottom_solid_layers: { orca: "bottom_shell_layers", prusa: "bottom_solid_layers" },
  fill_density: { orca: "sparse_infill_density", prusa: "fill_density", percent: true },
  sparse_infill_density: { orca: "sparse_infill_density", prusa: "fill_density", percent: true },
  fill_pattern: { orca: "sparse_infill_pattern", prusa: "fill_pattern" },
  support_material: { orca: "enable_support", prusa: "support_material" },
  support_material_auto: { orca: "support_material_auto", prusa: "support_material_auto" },
  // PP stores one blended print speed; Orca/Prusa split walls from infill, so
  // the single value seeds both rather than being silently dropped.
  print_speed_mm_s: {
    orca: ["inner_wall_speed", "sparse_infill_speed"],
    prusa: ["perimeter_speed", "infill_speed"],
  },
  first_layer_speed_mm_s: { orca: "initial_layer_speed", prusa: "first_layer_speed" },
  travel_speed_mm_s: { orca: "travel_speed", prusa: "travel_speed" },
  travel_speed: { orca: "travel_speed", prusa: "travel_speed" },
  bridge_speed_mm_s: { orca: "bridge_speed", prusa: "bridge_speed" },
  seam_position: { orca: "seam_position", prusa: "seam_position" },
  default_acceleration: { orca: "default_acceleration", prusa: "default_acceleration" },
  // PrusaSlicer only embeds the "; thumbnail begin/end" base64 PNG block the
  // sidecar decodes when this option is set, so it must survive translation.
  // Orca/Bambu carry the plate PNG inside the exported 3MF instead and have no
  // equivalent gcode-comment option, so it is dropped there rather than risking
  // an unknown key in the JSON preset.
  thumbnails: { orca: null, prusa: "thumbnails" },
  description: { orca: null, prusa: null },
};

/**
 * PrusaSlicer emits no plate thumbnail at all unless `thumbnails` is set, and
 * the sidecar treats a thumbnail-less gcode as a parse failure — so every Prusa
 * slice must carry one. PP has no UI/schema field for it, so we default it.
 * 220x124 is PrusaSlicer's own stock size (what the bundled PrusaLink-capable
 * printer profiles ship with).
 */
const PRUSA_DEFAULT_THUMBNAILS = "220x124";

const FILAMENT_KEY_MAP: Record<string, KeyMapEntry> = {
  material_type: { orca: "filament_type", prusa: "filament_type", perExtruder: true },
  filament_type: { orca: "filament_type", prusa: "filament_type", perExtruder: true },
  filament_vendor: { orca: "filament_vendor", prusa: "filament_vendor", perExtruder: true },
  nozzle_temp_c: { orca: "nozzle_temperature", prusa: "temperature", perExtruder: true },
  temperature: { orca: "nozzle_temperature", prusa: "temperature", perExtruder: true },
  nozzle_temp_first_layer_c: {
    orca: "nozzle_temperature_initial_layer",
    prusa: "first_layer_temperature",
    perExtruder: true,
  },
  first_layer_temperature: {
    orca: "nozzle_temperature_initial_layer",
    prusa: "first_layer_temperature",
    perExtruder: true,
  },
  bed_temp_c: { orca: "hot_plate_temp", prusa: "bed_temperature", perExtruder: true },
  bed_temperature: { orca: "hot_plate_temp", prusa: "bed_temperature", perExtruder: true },
  bed_temp_first_layer_c: {
    orca: "hot_plate_temp_initial_layer",
    prusa: "first_layer_bed_temperature",
    perExtruder: true,
  },
  first_layer_bed_temperature: {
    orca: "hot_plate_temp_initial_layer",
    prusa: "first_layer_bed_temperature",
    perExtruder: true,
  },
  fan_pct: { orca: "fan_max_speed", prusa: "max_fan_speed", perExtruder: true },
  max_fan_speed: { orca: "fan_max_speed", prusa: "max_fan_speed", perExtruder: true },
  fan_min_speed_pct: { orca: "fan_min_speed", prusa: "min_fan_speed", perExtruder: true },
  min_fan_speed: { orca: "fan_min_speed", prusa: "min_fan_speed", perExtruder: true },
  extrusion_multiplier: {
    orca: "filament_flow_ratio",
    prusa: "extrusion_multiplier",
    perExtruder: true,
  },
  retraction_length_mm: {
    orca: "filament_retraction_length",
    prusa: "filament_retract_length",
    perExtruder: true,
  },
  retraction_speed_mm_s: {
    orca: "filament_retraction_speed",
    prusa: "filament_retract_speed",
    perExtruder: true,
  },
  z_hop_mm: { orca: "filament_z_hop", prusa: "filament_retract_lift", perExtruder: true },
  filament_max_volumetric_speed: {
    orca: "filament_max_volumetric_speed",
    prusa: "filament_max_volumetric_speed",
    perExtruder: true,
  },
  // Klipper owns pressure advance (SET_PRESSURE_ADVANCE), and the min/max temp
  // guards are PP-side validation only — neither belongs in a slicer profile.
  pressure_advance: { orca: null, prusa: null },
  min_print_temp_c: { orca: null, prusa: null },
  max_print_temp_c: { orca: null, prusa: null },
  fan_pct_first_layer: { orca: null, prusa: null },
  description: { orca: null, prusa: null },
};

const KEY_MAPS: Record<SettingsRole, Record<string, KeyMapEntry>> = {
  machine: MACHINE_KEY_MAP,
  process: PROCESS_KEY_MAP,
  filament: FILAMENT_KEY_MAP,
};

/** Orca profile envelope `type` value per role. */
const ORCA_TYPE: Record<SettingsRole, string> = {
  machine: "machine",
  process: "process",
  filament: "filament",
};

/** JSON-profile slicers (shared Orca/Bambu lineage) vs PrusaSlicer's INI. */
function usesJsonProfiles(slicer: SlicerType): boolean {
  return slicer === "orca" || slicer === "bambu";
}

/** resolved_flat_configs key ("filament_2") -> role ("filament"). */
export function roleForConfigKey(key: string): SettingsRole {
  const lower = key.toLowerCase();
  if (lower.includes("filament")) return "filament";
  if (lower.includes("process") || lower.includes("print")) return "process";
  return "machine";
}

// ---------------------------------------------------------------------------
// Value serialization
// ---------------------------------------------------------------------------

/** Orca/Prusa write every scalar as a string; numbers in typed slots error out. */
function scalarToString(value: unknown): string {
  if (typeof value === "boolean") return value ? "1" : "0";
  if (value === null || value === undefined) return "";
  return String(value);
}

/** 0.4 -> "40%", 40 -> "40%", "15%" -> "15%". */
function toPercentString(value: unknown): string {
  if (typeof value === "string" && value.trim().endsWith("%")) return value.trim();
  const n = Number(value);
  if (!Number.isFinite(n)) return scalarToString(value);
  const pct = n > 0 && n <= 1 ? n * 100 : n;
  return `${Number(pct.toFixed(4))}%`;
}

function serializeValue(value: unknown, entry: KeyMapEntry, forJson: boolean): unknown {
  if (Array.isArray(value)) {
    const items = value.map((v) => (entry.percent ? toPercentString(v) : scalarToString(v)));
    return forJson ? items : items.join(",");
  }
  const scalar = entry.percent ? toPercentString(value) : scalarToString(value);
  // Orca per-extruder settings are arrays even for a single extruder;
  // PrusaSlicer INI expresses the same thing as a bare (comma-joined) value.
  if (forJson && entry.perExtruder) return [scalar];
  return scalar;
}

// ---------------------------------------------------------------------------
// Document builders
// ---------------------------------------------------------------------------

export type BuildSettingsDocsOptions = {
  slicer: SlicerType;
  configs: ResolvedFlatConfigs;
  /** Names used in each document's envelope + compatible_printers link. */
  machineName: string;
  /** Printer geometry, used to synthesize printable_area when absent. */
  printer?: PrinterMachine | null;
  sourceFormat?: "pp_native" | "slicer_native";
};

export type BuildSettingsDocsResult = {
  documents: ResolvedFlatConfigs;
  warnings: string[];
};

/**
 * Translate PP's flat configs into the target slicer's schema, one document
 * per input key. Pure — no filesystem access — so the schema is unit-testable
 * on its own.
 */
export function buildSettingsDocs(options: BuildSettingsDocsOptions): BuildSettingsDocsResult {
  const { slicer, configs, machineName, printer } = options;
  const sourceFormat = options.sourceFormat ?? "pp_native";
  const forJson = usesJsonProfiles(slicer);
  const documents: ResolvedFlatConfigs = {};
  const warnings: string[] = [];

  // compatible_printers must name the *machine preset*, not the PP printer:
  // both slicers resolve it against the loaded printer preset's `name`, so
  // linking to "Voron 350" while the preset is written as "Voron 350 machine"
  // silently leaves the process/filament incompatible with every printer.
  const machinePresetName = machinePresetNameFor(configs, machineName);

  for (const [key, config] of Object.entries(configs)) {
    const role = roleForConfigKey(key);
    const doc: FlatConfig = {};

    if (sourceFormat === "slicer_native") {
      Object.assign(doc, config);
    } else {
      const map = KEY_MAPS[role];
      const dropped: string[] = [];
      for (const [ppKey, value] of Object.entries(config)) {
        const entry = map[ppKey];
        if (!entry) {
          dropped.push(ppKey);
          continue;
        }
        const targets = forJson ? entry.orca : entry.prusa;
        if (targets === null) continue; // intentionally dropped
        for (const target of Array.isArray(targets) ? targets : [targets]) {
          doc[target] = serializeValue(value, entry, forJson);
        }
      }
      if (dropped.length) {
        warnings.push(
          `${key}: ${dropped.length} setting(s) have no ${slicer} equivalent and were omitted ` +
            `(${dropped.slice(0, 6).join(", ")}${dropped.length > 6 ? ", …" : ""}).`,
        );
      }
    }

    const docName = role === "machine" ? machinePresetName : `${machineName} ${role}`.trim();

    if (forJson) {
      // Orca/Bambu profile envelope. `instantiation: "true"` marks the preset
      // as directly usable (vs an abstract base meant only to be inherited).
      doc.type = ORCA_TYPE[role];
      doc.name = typeof doc.name === "string" && doc.name ? doc.name : docName;
      // Root cause of "The selected printer is not compatible with the
      // process preset in the 3mf": OrcaSlicer's CLI compatibility check
      // between a loaded machine preset and a process/filament preset whose
      // `compatible_printers` names it only passes when the machine preset's
      // `from` is "system" (a vendor/inherited preset) — a machine preset
      // marked `from: "User"` is rejected outright even when every other
      // field (name, nozzle_diameter, printable_area, …) matches exactly.
      // Verified against the real orca-slicer CLI binary: identical machine
      // JSON differing only in `from: "User"` vs `from: "system"` reproduces
      // and then resolves the failure. Process/filament presets are user
      // presets by nature and are unaffected — only the machine role needs
      // this override.
      doc.from = role === "machine" ? "system" : "User";
      doc.instantiation = "true";
      if (role === "machine") {
        if (!doc.printable_area) {
          const area = printableAreaFor(printer);
          if (area) doc.printable_area = area;
          else warnings.push("machine: no printable_area available; slicer bed defaults apply.");
        }
        if (!doc.printer_model) doc.printer_model = machineName;
      } else {
        // Without this link Orca can refuse to pair the process/filament with
        // the machine preset.
        doc.compatible_printers = [machinePresetName];
      }
    } else if (role !== "machine") {
      doc.compatible_printers = machinePresetName;
    }

    documents[key] = doc;
  }

  if (slicer === "prusa") ensurePrusaThumbnails(documents, machinePresetName);

  warnings.push(...missingRequiredFieldWarnings(slicer, documents));

  return { documents, warnings };
}

/**
 * Guarantee the rendered PrusaSlicer config set asks for a plate thumbnail.
 *
 * PrusaSlicer writes the `; thumbnail begin ... ; thumbnail end` base64 PNG
 * block only when `thumbnails` is set; without it the sidecar's prusa backend
 * raises SlicerOutputParseError and the whole slice fails with HTTP 502. PP has
 * no field for this in any profile schema, so nothing upstream can supply it —
 * the value has to be defaulted here or PrusaSlicer auto-slice can never work.
 *
 * Applied for every source format (an imported slicer-native Prusa profile that
 * happens to omit `thumbnails` fails identically), and only when no document
 * already sets it, so a user-supplied value always wins. PrusaSlicer's `--load`
 * merges every file into one flat config, so the key works from whichever
 * document carries it; process is preferred because that is where PP's own
 * print settings live.
 */
function ensurePrusaThumbnails(documents: ResolvedFlatConfigs, machinePresetName: string): void {
  for (const doc of Object.values(documents)) {
    const existing = doc.thumbnails;
    if (existing !== undefined && existing !== null && existing !== "") return;
  }

  const processKey = Object.keys(documents).find((k) => roleForConfigKey(k) === "process");
  if (processKey) {
    documents[processKey]!.thumbnails = PRUSA_DEFAULT_THUMBNAILS;
    return;
  }
  const machineKey = Object.keys(documents).find((k) => roleForConfigKey(k) === "machine");
  if (machineKey) {
    documents[machineKey]!.thumbnails = PRUSA_DEFAULT_THUMBNAILS;
    return;
  }
  // No machine or process document at all — PrusaSlicer would still slice off
  // its own defaults, so emit a minimal process file purely to carry the option.
  documents.process = {
    thumbnails: PRUSA_DEFAULT_THUMBNAILS,
    compatible_printers: machinePresetName,
  };
}

/**
 * Name the machine preset will be written under — a supplied `name` in the
 * machine config wins, otherwise the derived "<printer> machine". This is the
 * value process/filament docs must point `compatible_printers` at.
 */
function machinePresetNameFor(configs: ResolvedFlatConfigs, machineName: string): string {
  for (const [key, config] of Object.entries(configs)) {
    if (roleForConfigKey(key) !== "machine") continue;
    const own = config.name;
    if (typeof own === "string" && own.trim()) return own;
    break;
  }
  return `${machineName} machine`.trim();
}

/**
 * OrcaSlicer/BambuStudio abort with CLI_CONFIG_FILE_ERROR (-5) or
 * CLI_VALIDATE_ERROR (-51) when a loaded preset omits a required field, which
 * surfaces to the user as an opaque non-zero exit. Check the documented
 * minimum field set up front so the cause is named in the job warnings.
 * See ~/slicer-profile-research.md §9.
 */
const REQUIRED_JSON_FIELDS: Record<SettingsRole, string[]> = {
  machine: ["nozzle_diameter", "printable_area"],
  process: ["layer_height"],
  filament: ["filament_type"],
};

function missingRequiredFieldWarnings(
  slicer: SlicerType,
  documents: ResolvedFlatConfigs,
): string[] {
  if (!usesJsonProfiles(slicer)) return [];
  const warnings: string[] = [];
  for (const [key, doc] of Object.entries(documents)) {
    const required = REQUIRED_JSON_FIELDS[roleForConfigKey(key)];
    const missing = required.filter((f) => doc[f] === undefined || doc[f] === "");
    if (missing.length) {
      warnings.push(
        `${key}: missing ${slicer}-required field(s) ${missing.join(", ")}; ` +
          "the CLI may reject this preset (exit -5/-51).",
      );
    }
  }
  return warnings;
}

/** Orca's printable_area polygon ("0x0", "WxD", …) from PP bed dimensions. */
function printableAreaFor(printer: PrinterMachine | null | undefined): string[] | null {
  const w = printer?.bed_width_mm;
  const d = printer?.bed_depth_mm;
  if (!w || !d || !Number.isFinite(w) || !Number.isFinite(d)) return null;
  return ["0x0", `${w}x0`, `${w}x${d}`, `0x${d}`];
}

/** PrusaSlicer flat-INI body: `key = value` lines, newlines escaped. */
export function renderPrusaIni(doc: FlatConfig): string {
  const lines = Object.entries(doc).map(([key, value]) => {
    const raw = Array.isArray(value) ? value.map(scalarToString).join(",") : scalarToString(value);
    return `${key} = ${raw.replace(/\r?\n/g, "\\n")}`;
  });
  return `${lines.join("\n")}\n`;
}

/** Filesystem-safe basename for an untrusted config key. */
function safeKey(key: string): string {
  const cleaned = key.replace(/[^A-Za-z0-9_-]/g, "_").replace(/^_+|_+$/g, "");
  return cleaned || "config";
}

/**
 * Write already-slicer-shaped documents to `dir`, one file per key, and tag
 * each with the CLI flag it is passed under.
 *
 * OrcaSlicer/BambuStudio order matters: machine must precede process in the
 * semicolon-joined `--load-settings` list, so machine-role files sort first.
 */
export function writeSettingsFiles(
  slicer: SlicerType,
  documents: ResolvedFlatConfigs,
  dir: string,
): SettingsFile[] {
  mkdirSync(dir, { recursive: true });
  const json = usesJsonProfiles(slicer);
  const files: SettingsFile[] = [];

  const entries = Object.entries(documents).sort(([a], [b]) => {
    const order: Record<SettingsRole, number> = { machine: 0, process: 1, filament: 2 };
    const diff = order[roleForConfigKey(a)] - order[roleForConfigKey(b)];
    return diff !== 0 ? diff : a.localeCompare(b);
  });

  for (const [key, doc] of entries) {
    const role = roleForConfigKey(key);
    const filename = `${safeKey(key)}.${json ? "json" : "ini"}`;
    const path = join(dir, filename);
    writeFileSync(path, json ? `${JSON.stringify(doc, null, 2)}\n` : renderPrusaIni(doc), "utf8");
    files.push({
      key,
      role,
      filename,
      path,
      cliFlag: json ? (role === "filament" ? "--load-filaments" : "--load-settings") : "--load",
      document: json ? doc : null,
    });
  }

  return files;
}

/**
 * Build the OrcaSlicer/BambuStudio CLI argument list for a settings set.
 * Exposed so callers (and tests) can see the exact flag grouping the files
 * were prepared for without re-deriving it.
 */
export function settingsCliArgs(files: SettingsFile[]): string[] {
  const args: string[] = [];
  const settings = files.filter((f) => f.cliFlag === "--load-settings").map((f) => f.path);
  const filaments = files.filter((f) => f.cliFlag === "--load-filaments").map((f) => f.path);
  if (settings.length) args.push("--load-settings", settings.join(";"));
  if (filaments.length) args.push("--load-filaments", filaments.join(";"));
  for (const f of files.filter((x) => x.cliFlag === "--load")) args.push("--load", f.path);
  return args;
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

/**
 * Resolve the slicer for a printer and assemble its settings files.
 *
 * Call this before invoking the sidecar: `slicerType` selects the sidecar
 * backend, `resolvedFlatConfigs` is the request payload, and `settingsFiles`
 * are the same documents on disk for a direct CLI call or for logging.
 * Remember to call `cleanup()` once the slice finishes.
 */
export function resolveSlicerAndSettings(
  repo: AppRepository,
  printer: PrinterMachine | null | undefined,
  options: ResolveSlicerAndSettingsOptions = {},
): ResolveSlicerAndSettingsResult {
  const warnings: string[] = [];

  const selection = options.slicer
    ? ({ slicer: options.slicer, reason: "default" } as SlicerSelection)
    : selectSlicerForPrinter(repo, printer);
  const slicerType = selection.slicer;

  let configs: ResolvedFlatConfigs;
  let sources: Record<string, { id: number; name: string }> = {};
  if (options.resolvedFlatConfigs) {
    configs = options.resolvedFlatConfigs;
  } else {
    const resolved = resolveFlatConfigsForPrinter(repo, printer, slicerType);
    configs = resolved.configs;
    sources = resolved.sources;
    warnings.push(...resolved.warnings);
  }

  const machineName = (printer?.name ?? "").trim() || "PP Printer";
  const built = buildSettingsDocs({
    slicer: slicerType,
    configs,
    machineName,
    printer,
    sourceFormat: options.sourceFormat,
  });
  warnings.push(...built.warnings);

  const ownsDir = !options.outDir;
  const dir = options.outDir ?? mkdtempSync(join(tmpdir(), "pp-slice-"));
  const settingsFiles = writeSettingsFiles(slicerType, built.documents, dir);

  return {
    slicerType,
    slicerReason: selection.reason,
    settingsFiles,
    resolvedFlatConfigs: built.documents,
    dir,
    sources,
    warnings,
    cleanup: () => {
      if (ownsDir) rmSync(dir, { recursive: true, force: true });
    },
  };
}
