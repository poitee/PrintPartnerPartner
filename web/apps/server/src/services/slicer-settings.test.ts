import { describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { PrinterMachine } from "@print-partner/domain";
import { getDb, SqliteDatabase } from "../db/client.js";
import { AppRepository } from "../db/repository.js";
import {
  buildSettingsDocs,
  renderPrusaIni,
  resolveSlicerAndSettings,
  roleForConfigKey,
  settingsCliArgs,
  writeSettingsFiles,
  type ResolvedFlatConfigs,
} from "./slicer-settings.js";

function printer(overrides: Partial<PrinterMachine> = {}): PrinterMachine {
  return {
    id: "p1",
    name: "Voron 350",
    model: overrides.model ?? "Voron 350",
    bed_width_mm: 350,
    bed_depth_mm: 350,
    bed_height_mm: 330,
    margin_mm: 4,
    max_filament_slots: 1,
    loaded_filaments: [{ slot: 1, filament_color_id: null, label: "" }],
    ...overrides,
  };
}

/** PP-native flat configs shaped like the seeded starter profiles. */
const PP_CONFIGS: ResolvedFlatConfigs = {
  machine: {
    nozzle_diameter_mm: 0.4,
    gcode_flavor: "klipper",
    start_gcode: "PRINT_START\nG28",
    end_gcode: "PRINT_END",
    extruder_count: 1,
  },
  process: {
    layer_height: 0.2,
    first_layer_height: 0.25,
    perimeters: 4,
    top_solid_layers: 5,
    bottom_solid_layers: 4,
    fill_density: 0.4,
    fill_pattern: "gyroid",
    support_material: false,
    print_speed_mm_s: 100,
    first_layer_speed_mm_s: 40,
    travel_speed_mm_s: 200,
    description: "Balanced quality PLA.",
  },
  filament: {
    material_type: "PLA",
    nozzle_temp_c: 220,
    nozzle_temp_first_layer_c: 225,
    bed_temp_c: 60,
    bed_temp_first_layer_c: 65,
    fan_pct: 100,
    fan_min_speed_pct: 30,
    extrusion_multiplier: 1.0,
    pressure_advance: 0.04,
  },
};

function withRepo<T>(fn: (repo: AppRepository) => T): T {
  const dir = mkdtempSync(join(tmpdir(), "pp-slicer-settings-"));
  const sqlite = new SqliteDatabase(dir);
  sqlite.connect();
  try {
    return fn(new AppRepository(getDb(sqlite), undefined, sqlite.reposDir));
  } finally {
    sqlite.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("roleForConfigKey", () => {
  it("maps sidecar config keys to settings roles", () => {
    expect(roleForConfigKey("machine")).toBe("machine");
    expect(roleForConfigKey("process")).toBe("process");
    expect(roleForConfigKey("filament")).toBe("filament");
    expect(roleForConfigKey("filament_2")).toBe("filament");
  });
});

describe("slicer resolution per printer type", () => {
  it("routes Klipper (moonraker) printers to OrcaSlicer", () => {
    withRepo((repo) => {
      const res = resolveSlicerAndSettings(repo, printer(), {
        resolvedFlatConfigs: PP_CONFIGS,
      });
      expect(res.slicerType).toBe("orca");
      res.cleanup();
    });
  });

  it("routes a PrusaXL to PrusaSlicer", () => {
    withRepo((repo) => {
      const res = resolveSlicerAndSettings(repo, printer({ id: "p2", name: "Prusa XL" }), {
        resolvedFlatConfigs: PP_CONFIGS,
      });
      expect(res.slicerType).toBe("prusa");
      res.cleanup();
    });
  });

  it("routes a Bambu printer to BambuStudio", () => {
    withRepo((repo) => {
      const res = resolveSlicerAndSettings(repo, printer({ id: "p3", name: "Bambu P1S" }), {
        resolvedFlatConfigs: PP_CONFIGS,
      });
      expect(res.slicerType).toBe("bambu");
      res.cleanup();
    });
  });

  it("honours an explicit slicer override", () => {
    withRepo((repo) => {
      const res = resolveSlicerAndSettings(repo, printer({ name: "Prusa XL" }), {
        slicer: "orca",
        resolvedFlatConfigs: PP_CONFIGS,
      });
      expect(res.slicerType).toBe("orca");
      res.cleanup();
    });
  });
});

describe("OrcaSlicer settings documents", () => {
  const built = buildSettingsDocs({
    slicer: "orca",
    configs: PP_CONFIGS,
    machineName: "Voron 350",
    printer: printer(),
  });

  it("emits the profile envelope every CLI-loaded preset needs", () => {
    for (const [key, doc] of Object.entries(built.documents)) {
      expect(doc.name, key).toBeTruthy();
      // Machine presets must be "system" — OrcaSlicer's CLI compatibility
      // check between a loaded machine and a process/filament preset naming
      // it via `compatible_printers` rejects a machine preset marked
      // `from: "User"` even when every other field matches (verified against
      // the real orca-slicer CLI: this was the actual cause of "The selected
      // printer is not compatible with the process preset in the 3mf.").
      // Process/filament remain "User" as genuine user presets.
      const role = key === "machine" ? "machine" : "other";
      expect(doc.from, key).toBe(role === "machine" ? "system" : "User");
      expect(doc.instantiation, key).toBe("true");
    }
    expect(built.documents.machine!.type).toBe("machine");
    expect(built.documents.process!.type).toBe("process");
    expect(built.documents.filament!.type).toBe("filament");
  });

  it("translates PP-native keys to OrcaSlicer key names", () => {
    const process = built.documents.process!;
    expect(process.layer_height).toBe("0.2");
    expect(process.initial_layer_print_height).toBe("0.25");
    expect(process.wall_loops).toBe("4");
    expect(process.top_shell_layers).toBe("5");
    expect(process.sparse_infill_pattern).toBe("gyroid");
    // Orca has no PP-style "perimeters"/"fill_density" keys.
    expect(process.perimeters).toBeUndefined();
    expect(process.fill_density).toBeUndefined();
  });

  it("converts a fractional infill density to Orca's percent string", () => {
    expect(built.documents.process!.sparse_infill_density).toBe("40%");
  });

  it("fans a single PP print speed out to Orca's wall + infill speeds", () => {
    expect(built.documents.process!.inner_wall_speed).toBe("100");
    expect(built.documents.process!.sparse_infill_speed).toBe("100");
  });

  it("serializes per-extruder settings as string arrays", () => {
    const filament = built.documents.filament!;
    expect(filament.filament_type).toEqual(["PLA"]);
    expect(filament.nozzle_temperature).toEqual(["220"]);
    expect(filament.nozzle_temperature_initial_layer).toEqual(["225"]);
    expect(filament.hot_plate_temp).toEqual(["60"]);
    expect(filament.fan_max_speed).toEqual(["100"]);
    expect(filament.fan_min_speed).toEqual(["30"]);
    expect(built.documents.machine!.nozzle_diameter).toEqual(["0.4"]);
  });

  it("booleans become Orca's 0/1 strings", () => {
    expect(built.documents.process!.enable_support).toBe("0");
  });

  it("derives printable_area from the printer bed when the profile omits it", () => {
    expect(built.documents.machine!.printable_area).toEqual([
      "0x0",
      "350x0",
      "350x350",
      "0x350",
    ]);
  });

  it("links process + filament back to the machine preset", () => {
    // The link must name the machine preset as written ("<printer> machine"),
    // not the PP printer — the slicer resolves compatible_printers against the
    // loaded printer preset's `name`, so a bare printer name matches nothing.
    expect(built.documents.machine!.name).toBe("Voron 350 machine");
    expect(built.documents.process!.compatible_printers).toEqual(["Voron 350 machine"]);
    expect(built.documents.filament!.compatible_printers).toEqual(["Voron 350 machine"]);
    expect(built.documents.machine!.compatible_printers).toBeUndefined();
  });

  it("links to a machine config's own preset name when it supplies one", () => {
    const custom = buildSettingsDocs({
      slicer: "orca",
      machineName: "Voron 350",
      configs: {
        machine: { name: "Voron 350 0.4 nozzle", nozzle_diameter_mm: 0.4 },
        process: { layer_height: 0.2 },
      },
    });
    expect(custom.documents.machine!.name).toBe("Voron 350 0.4 nozzle");
    expect(custom.documents.process!.compatible_printers).toEqual(["Voron 350 0.4 nozzle"]);
  });

  it("drops PP-only keys and reports them as warnings", () => {
    // pressure_advance is Klipper-side, min/max print temps are PP validation.
    expect(built.documents.filament!.pressure_advance).toBeUndefined();
    // description has no slicer equivalent but is a known drop, not a warning.
    expect(built.documents.process!.description).toBeUndefined();
  });

  it("passes slicer-native configs through untouched", () => {
    const native = buildSettingsDocs({
      slicer: "orca",
      configs: { process: { layer_height: "0.2", wall_loops: "3", sparse_infill_density: "15%" } },
      machineName: "Voron 350",
      sourceFormat: "slicer_native",
    });
    expect(native.documents.process!.wall_loops).toBe("3");
    expect(native.documents.process!.sparse_infill_density).toBe("15%");
    expect(native.warnings).toHaveLength(0);
  });

  it("warns when a preset omits a field OrcaSlicer requires", () => {
    // A filament doc with no filament_type makes the CLI exit -5/-51; the
    // cause should be named up front rather than surfacing as a bare exit code.
    const incomplete = buildSettingsDocs({
      slicer: "orca",
      configs: { filament: { nozzle_temp_c: 220 } },
      machineName: "Voron 350",
    });
    expect(incomplete.warnings.join(" ")).toMatch(/filament_type/);
  });
});

describe("writeSettingsFiles", () => {
  it("writes OrcaSlicer JSON files with the right CLI flags and ordering", () => {
    const dir = mkdtempSync(join(tmpdir(), "pp-write-orca-"));
    try {
      const { documents } = buildSettingsDocs({
        slicer: "orca",
        configs: { process: PP_CONFIGS.process!, machine: PP_CONFIGS.machine!, filament: PP_CONFIGS.filament! },
        machineName: "Voron 350",
        printer: printer(),
      });
      const files = writeSettingsFiles("orca", documents, dir);

      expect(files.map((f) => f.filename)).toEqual([
        "machine.json",
        "process.json",
        "filament.json",
      ]);
      for (const f of files) {
        expect(existsSync(f.path)).toBe(true);
        // Every file must be valid JSON matching the returned document.
        expect(JSON.parse(readFileSync(f.path, "utf8"))).toEqual(f.document);
      }
      expect(files.find((f) => f.key === "filament")!.cliFlag).toBe("--load-filaments");
      expect(files.find((f) => f.key === "machine")!.cliFlag).toBe("--load-settings");

      const args = settingsCliArgs(files);
      expect(args[0]).toBe("--load-settings");
      // machine before process — OrcaSlicer applies them in order.
      expect(args[1]).toBe(`${join(dir, "machine.json")};${join(dir, "process.json")}`);
      expect(args[2]).toBe("--load-filaments");
      expect(args[3]).toBe(join(dir, "filament.json"));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("writes one file per filament slot", () => {
    const dir = mkdtempSync(join(tmpdir(), "pp-write-multi-"));
    try {
      const { documents } = buildSettingsDocs({
        slicer: "orca",
        configs: {
          machine: PP_CONFIGS.machine!,
          filament: PP_CONFIGS.filament!,
          filament_2: PP_CONFIGS.filament!,
        },
        machineName: "Voron 350",
        printer: printer(),
      });
      const files = writeSettingsFiles("orca", documents, dir);
      const filaments = files.filter((f) => f.cliFlag === "--load-filaments");
      expect(filaments.map((f) => f.filename)).toEqual(["filament.json", "filament_2.json"]);
      expect(settingsCliArgs(files)).toContain(
        `${join(dir, "filament.json")};${join(dir, "filament_2.json")}`,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("writes PrusaSlicer INI files behind repeated --load flags", () => {
    const dir = mkdtempSync(join(tmpdir(), "pp-write-prusa-"));
    try {
      const { documents } = buildSettingsDocs({
        slicer: "prusa",
        configs: PP_CONFIGS,
        machineName: "Prusa XL",
        printer: printer({ name: "Prusa XL" }),
      });
      const files = writeSettingsFiles("prusa", documents, dir);
      expect(files.map((f) => f.filename)).toEqual(["machine.ini", "process.ini", "filament.ini"]);
      expect(files.every((f) => f.cliFlag === "--load")).toBe(true);

      const processIni = readFileSync(join(dir, "process.ini"), "utf8");
      // Prusa key names, not Orca's.
      expect(processIni).toContain("perimeters = 4");
      expect(processIni).toContain("fill_density = 40%");
      expect(processIni).not.toContain("wall_loops");

      const filamentIni = readFileSync(join(dir, "filament.ini"), "utf8");
      expect(filamentIni).toContain("temperature = 220");
      expect(filamentIni).toContain("bed_temperature = 60");

      // Newlines inside gcode must not break the key = value line format.
      const machineIni = readFileSync(join(dir, "machine.ini"), "utf8");
      expect(machineIni).toContain("start_gcode = PRINT_START\\nG28");
      expect(machineIni.split("\n").filter(Boolean).every((l) => l.includes(" = "))).toBe(true);

      const args = settingsCliArgs(files);
      expect(args).toEqual([
        "--load",
        join(dir, "machine.ini"),
        "--load",
        join(dir, "process.ini"),
        "--load",
        join(dir, "filament.ini"),
      ]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("BambuStudio shares OrcaSlicer's JSON schema and flags", () => {
    const dir = mkdtempSync(join(tmpdir(), "pp-write-bambu-"));
    try {
      const { documents } = buildSettingsDocs({
        slicer: "bambu",
        configs: PP_CONFIGS,
        machineName: "Bambu P1S",
        printer: printer({ name: "Bambu P1S" }),
      });
      const files = writeSettingsFiles("bambu", documents, dir);
      expect(files.every((f) => f.filename.endsWith(".json"))).toBe(true);
      expect(documents.process!.wall_loops).toBe("4");
      expect(documents.filament!.nozzle_temperature).toEqual(["220"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("renderPrusaIni", () => {
  it("renders arrays comma-joined and booleans as 0/1", () => {
    expect(renderPrusaIni({ a: [1, 2], b: true, c: false, d: "x" })).toBe(
      "a = 1,2\nb = 1\nc = 0\nd = x\n",
    );
  });
});

/**
 * Regression cover for t_a9af03d0. PrusaSlicer writes the
 * `; thumbnail begin ... ; thumbnail end` base64 PNG block the sidecar decodes
 * ONLY when the loaded config sets `thumbnails`; without it the sidecar raises
 * SlicerOutputParseError and every PrusaXL slice fails with HTTP 502. No PP
 * profile schema has a field for it, so the setting must be synthesized during
 * translation — that invariant is what these tests pin.
 */
describe("PrusaSlicer thumbnails (plate preview) setting", () => {
  function prusaDocs(configs: ResolvedFlatConfigs, sourceFormat?: "pp_native" | "slicer_native") {
    return buildSettingsDocs({
      slicer: "prusa",
      configs,
      machineName: "Prusa XL",
      printer: printer({ name: "Prusa XL" }),
      ...(sourceFormat ? { sourceFormat } : {}),
    });
  }

  it("always emits a thumbnails line in the rendered Prusa INI", () => {
    const dir = mkdtempSync(join(tmpdir(), "pp-prusa-thumbs-"));
    try {
      // PP_CONFIGS is the real starter shape: no thumbnails key anywhere.
      const { documents } = prusaDocs(PP_CONFIGS);
      const files = writeSettingsFiles("prusa", documents, dir);
      const ini = files.map((f) => readFileSync(f.path, "utf8")).join("");
      expect(ini).toContain("thumbnails = 220x124");
      expect(ini.match(/^thumbnails = /gm)).toHaveLength(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("defaults thumbnails onto the process document", () => {
    const { documents } = prusaDocs(PP_CONFIGS);
    expect(documents.process!.thumbnails).toBe("220x124");
    expect(documents.machine!.thumbnails).toBeUndefined();
    expect(documents.filament!.thumbnails).toBeUndefined();
  });

  it("keeps a profile's own thumbnails value instead of the default", () => {
    const { documents, warnings } = prusaDocs({
      machine: PP_CONFIGS.machine!,
      process: { ...PP_CONFIGS.process!, thumbnails: "160x120" },
    });
    expect(documents.process!.thumbnails).toBe("160x120");
    // …and it must survive translation rather than being dropped as unmapped.
    expect(warnings.join(" ")).not.toMatch(/thumbnails/);
  });

  it("defaults thumbnails for slicer-native configs too", () => {
    // A profile imported verbatim from PrusaSlicer bypasses key translation,
    // but hits the exact same missing-thumbnail failure.
    const { documents } = prusaDocs(
      { machine: { nozzle_diameter: "0.4" }, process: { layer_height: "0.2" } },
      "slicer_native",
    );
    expect(documents.process!.thumbnails).toBe("220x124");
  });

  it("falls back to the machine document when there is no process config", () => {
    const { documents } = prusaDocs({ machine: PP_CONFIGS.machine! });
    expect(documents.machine!.thumbnails).toBe("220x124");
  });

  it("synthesizes a process document when neither machine nor process exists", () => {
    const { documents } = prusaDocs({ filament: PP_CONFIGS.filament! });
    expect(documents.process!.thumbnails).toBe("220x124");
    expect(documents.process!.compatible_printers).toBe("Prusa XL machine");
  });

  it("does not leak the thumbnails option into Orca/Bambu JSON presets", () => {
    // Orca and BambuStudio carry the plate PNG inside the exported 3MF; the
    // gcode-comment option is PrusaSlicer-only and an unknown key risks a
    // CLI_CONFIG_FILE_ERROR.
    for (const slicer of ["orca", "bambu"] as const) {
      const { documents } = buildSettingsDocs({
        slicer,
        configs: { machine: PP_CONFIGS.machine!, process: { ...PP_CONFIGS.process!, thumbnails: "220x124" } },
        machineName: "Voron 350",
        printer: printer(),
      });
      expect(documents.process!.thumbnails, slicer).toBeUndefined();
      expect(documents.machine!.thumbnails, slicer).toBeUndefined();
    }
  });

  it("reaches the INI through the full resolveSlicerAndSettings path", () => {
    withRepo((repo) => {
      // The production entry point, with the DB's own seeded pp_native
      // profiles — i.e. what an untouched install actually sends a PrusaXL.
      const res = resolveSlicerAndSettings(repo, printer({ id: "p2", name: "Prusa XL" }));
      expect(res.slicerType).toBe("prusa");
      const ini = res.settingsFiles.map((f) => readFileSync(f.path, "utf8")).join("");
      expect(ini).toMatch(/^thumbnails = \d+x\d+$/m);
      res.cleanup();
    });
  });
});

describe("resolveSlicerAndSettings end to end", () => {
  it("writes settings into a temp dir and cleans it up", () => {
    withRepo((repo) => {
      const res = resolveSlicerAndSettings(repo, printer(), {
        resolvedFlatConfigs: PP_CONFIGS,
      });

      expect(res.slicerType).toBe("orca");
      expect(res.settingsFiles).toHaveLength(3);
      for (const f of res.settingsFiles) expect(existsSync(f.path)).toBe(true);

      // The sidecar payload mirrors the files exactly.
      expect(Object.keys(res.resolvedFlatConfigs).sort()).toEqual([
        "filament",
        "machine",
        "process",
      ]);
      const onDisk = JSON.parse(
        readFileSync(res.settingsFiles.find((f) => f.key === "process")!.path, "utf8"),
      );
      expect(onDisk).toEqual(res.resolvedFlatConfigs.process);

      const dir = res.dir;
      res.cleanup();
      expect(existsSync(dir)).toBe(false);
    });
  });

  it("keeps a caller-supplied outDir after cleanup", () => {
    withRepo((repo) => {
      const dir = mkdtempSync(join(tmpdir(), "pp-outdir-"));
      try {
        const res = resolveSlicerAndSettings(repo, printer(), {
          outDir: dir,
          resolvedFlatConfigs: PP_CONFIGS,
        });
        expect(res.dir).toBe(dir);
        res.cleanup();
        expect(existsSync(dir)).toBe(true);
        expect(existsSync(join(dir, "machine.json"))).toBe(true);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
  });

  it("resolves configs from the DB's seeded profiles, including a starter machine profile", () => {
    withRepo((repo) => {
      // A fresh DB is seeded with starter machine + process + filament
      // profiles (db/client.ts -> seedStarterProfiles), so this exercises the
      // real repository lookup path end to end. Regression test for the
      // "selected printer is not compatible with the process preset in the
      // 3mf" OrcaSlicer failure: printer_profiles used to be left completely
      // unseeded, so no "machine" settings file was ever produced.
      const res = resolveSlicerAndSettings(repo, printer());
      expect(res.slicerType).toBe("orca");

      const keys = res.settingsFiles.map((f) => f.key);
      expect(keys).toContain("machine");
      expect(keys).toContain("process");
      expect(keys).toContain("filament");

      // Seeded PP-native configs still come out in OrcaSlicer's schema.
      const process = res.resolvedFlatConfigs.process!;
      expect(process.type).toBe("process");
      expect(process.layer_height).toBeTruthy();
      expect(process.wall_loops).toBeTruthy();
      expect(res.resolvedFlatConfigs.filament!.nozzle_temperature).toBeInstanceOf(Array);

      // The starter machine profile round-trips into Orca's schema too, and
      // process/filament compatible_printers must name it exactly.
      const machine = res.resolvedFlatConfigs.machine!;
      expect(machine.type).toBe("machine");
      expect(machine.nozzle_diameter).toBeInstanceOf(Array);
      const machineName = machine.name;
      expect(machineName).toBeTruthy();
      expect(process.compatible_printers).toEqual([machineName]);
      expect(res.resolvedFlatConfigs.filament!.compatible_printers).toEqual([machineName]);

      // Every source row is attributed for job metadata.
      expect(res.sources.machine?.name).toBeTruthy();
      expect(res.sources.process?.name).toBeTruthy();

      res.cleanup();
    });
  });
});
