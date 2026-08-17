import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { PrinterMachine } from "@print-partner/domain";
import { getDb, SqliteDatabase } from "../db/client.js";
import { AppRepository, type SlicerProfileRow } from "../db/repository.js";
import { createIntegrationPort } from "../integrations/store.js";
import { slicerSidecarAdapter } from "../integrations/adapters/slicer-sidecar.js";
import {
  pickProfileForPrinter,
  profileMatchesSlicer,
  resolveFlatConfigsForPrinter,
  selectSlicerForPrinter,
} from "./slicer-routing.js";

function withRepo<T>(fn: (repo: AppRepository, sqlite: SqliteDatabase) => T): T {
  const dir = mkdtempSync(join(tmpdir(), "pp-slicer-routing-"));
  const sqlite = new SqliteDatabase(dir);
  sqlite.connect();
  const repo = new AppRepository(getDb(sqlite), undefined, sqlite.reposDir);
  try {
    return fn(repo, sqlite);
  } finally {
    sqlite.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

function printer(overrides: Partial<PrinterMachine> = {}): PrinterMachine {
  return {
    id: "p1",
    name: "Printer",
    bed_width_mm: 250,
    bed_depth_mm: 210,
    bed_height_mm: 220,
    margin_mm: 4,
    max_filament_slots: 1,
    loaded_filaments: [{ slot: 1, filament_color_id: null, label: "" }],
    ...overrides,
  };
}

function row(
  id: number,
  name: string,
  slicerFormat: string | null,
  config: Record<string, unknown> | null,
): SlicerProfileRow {
  return {
    id,
    name,
    slicerFormat,
    resolvedFlatConfig: config ? JSON.stringify(config) : null,
  };
}

/**
 * Insert one printer/process profile per slicer dialect plus two filament
 * rows. Names are prefixed so they can't collide with the pp_native starter
 * profiles that SqliteDatabase.connect() seeds.
 */
function seedProfiles(sqlite: SqliteDatabase): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = (sqlite as any).sqlite as import("better-sqlite3").Database;
  const now = new Date().toISOString();
  const printers: Array<[string, string, string]> = [
    ["Voron 350 0.4", "orca", '{"printer_model":"Voron350","nozzle_diameter":"0.4"}'],
    ["Prusa XL 0.4", "prusa", '{"printer_model":"XL","nozzle_diameter":"0.4"}'],
    ["Bambu X1C 0.4", "bambu", '{"printer_model":"X1C","nozzle_diameter":"0.4"}'],
  ];
  for (const [name, format, cfg] of printers) {
    db.prepare(
      `INSERT INTO printer_profiles (tenant_id, name, slicer_format, resolved_flat_config, imported_at)
       VALUES (?, ?, ?, ?, ?)`,
    ).run("default", name, format, cfg, now);
  }
  const processes: Array<[string, string, string]> = [
    ["Imported Orca 0.2", "orca", '{"layer_height":"0.2"}'],
    ["Imported Prusa 0.2", "prusa", '{"layer_height":"0.2"}'],
    ["Imported Bambu 0.2", "bambu", '{"layer_height":"0.2"}'],
  ];
  for (const [name, format, cfg] of processes) {
    db.prepare(
      `INSERT INTO process_profiles (tenant_id, name, slicer_format, resolved_flat_config, imported_at)
       VALUES (?, ?, ?, ?, ?)`,
    ).run("default", name, format, cfg, now);
  }
  const filaments: Array<[string, string, string]> = [
    ["Imported PLA", "PLA", '{"filament_type":"PLA","nozzle_temperature":"215"}'],
    ["Imported PETG", "PETG", '{"filament_type":"PETG","nozzle_temperature":"240"}'],
  ];
  for (const [name, material, cfg] of filaments) {
    db.prepare(
      `INSERT INTO filament_profiles (tenant_id, name, material_type, resolved_flat_config, imported_at)
       VALUES (?, ?, ?, ?, ?)`,
    ).run("default", name, material, cfg, now);
  }
}

describe("selectSlicerForPrinter", () => {
  it("routes each integration type to its slicer", () => {
    withRepo((repo) => {
      const port = createIntegrationPort({
        repo,
        getAdapter: (type) => (type === "slicer_sidecar" ? slicerSidecarAdapter : undefined),
      });
      const moonraker = port.create({
        type: "moonraker",
        name: "Voron",
        config: { url: "http://voron.home" },
      });
      const prusalink = port.create({
        type: "prusalink",
        name: "XL",
        config: { url: "http://xl.home" },
      });
      const bambu = port.create({
        type: "bambu",
        name: "X1C",
        config: { host: "192.168.1.9" },
      });

      expect(
        selectSlicerForPrinter(repo, printer({ integration_id: moonraker.id })),
      ).toEqual({ slicer: "orca", reason: "integration" });
      expect(
        selectSlicerForPrinter(repo, printer({ integration_id: prusalink.id })),
      ).toEqual({ slicer: "prusa", reason: "integration" });
      expect(selectSlicerForPrinter(repo, printer({ integration_id: bambu.id }))).toEqual({
        slicer: "bambu",
        reason: "integration",
      });
    });
  });

  it("falls back to the printer name when no integration is bound", () => {
    withRepo((repo) => {
      expect(selectSlicerForPrinter(repo, printer({ name: "Prusa XL" })).slicer).toBe("prusa");
      expect(selectSlicerForPrinter(repo, printer({ name: "Bambu P1S" })).slicer).toBe("bambu");
      expect(selectSlicerForPrinter(repo, printer({ name: "Voron 350" })).slicer).toBe("orca");
      // Unknown machines slice on Orca (documented default for Klipper).
      expect(selectSlicerForPrinter(repo, printer({ name: "Ender 3" }))).toEqual({
        slicer: "orca",
        reason: "default",
      });
      expect(selectSlicerForPrinter(repo, null).slicer).toBe("orca");
    });
  });

  it("prefers the integration binding over a misleading printer name", () => {
    withRepo((repo) => {
      const port = createIntegrationPort({ repo, getAdapter: () => undefined });
      const prusalink = port.create({
        type: "prusalink",
        name: "XL",
        config: { url: "http://xl.home" },
      });
      // Name says Bambu, host says PrusaLink — the real binding wins.
      const selection = selectSlicerForPrinter(
        repo,
        printer({ name: "Bambu-ish alias", integration_id: prusalink.id }),
      );
      expect(selection).toEqual({ slicer: "prusa", reason: "integration" });
    });
  });

  it("explicit preferred_slicer override wins over integration binding", () => {
    withRepo((repo) => {
      const port = createIntegrationPort({
        repo,
        getAdapter: (type) => (type === "slicer_sidecar" ? slicerSidecarAdapter : undefined),
      });
      const moonraker = port.create({
        type: "moonraker",
        name: "Redoubt",
        config: { url: "http://redoubt.home" },
      });
      // Would normally route to orca via the moonraker integration.
      const selection = selectSlicerForPrinter(
        repo,
        printer({ integration_id: moonraker.id, preferred_slicer: "prusa" }),
      );
      expect(selection).toEqual({ slicer: "prusa", reason: "override" });
    });
  });

  it("explicit preferred_slicer override wins over the printer-name fallback", () => {
    withRepo((repo) => {
      const selection = selectSlicerForPrinter(
        repo,
        printer({ name: "Prusa XL", preferred_slicer: "bambu" }),
      );
      expect(selection).toEqual({ slicer: "bambu", reason: "override" });
    });
  });

  it("null preferred_slicer (Auto) falls through to the existing routing", () => {
    withRepo((repo) => {
      expect(
        selectSlicerForPrinter(repo, printer({ name: "Prusa XL", preferred_slicer: null })),
      ).toEqual({ slicer: "prusa", reason: "printer_name" });
    });
  });

  it("ignores an invalid/garbage preferred_slicer value and falls back", () => {
    withRepo((repo) => {
      const selection = selectSlicerForPrinter(
        repo,
        // @ts-expect-error intentionally invalid value to prove routing is defensive
        printer({ name: "Prusa XL", preferred_slicer: "nonsense" }),
      );
      expect(selection).toEqual({ slicer: "prusa", reason: "printer_name" });
    });
  });
});

describe("profileMatchesSlicer / pickProfileForPrinter", () => {
  it("keeps prusa INI profiles away from orca and vice versa", () => {
    const orcaRow = row(1, "Voron 350", "orca", { a: 1 });
    const prusaRow = row(2, "Prusa XL", "prusa", { a: 1 });
    expect(profileMatchesSlicer(orcaRow, "orca")).toBe(true);
    expect(profileMatchesSlicer(orcaRow, "prusa")).toBe(false);
    expect(profileMatchesSlicer(prusaRow, "prusa")).toBe(true);
    expect(profileMatchesSlicer(prusaRow, "orca")).toBe(false);
    // Orca and BambuStudio share the JSON profile lineage.
    expect(profileMatchesSlicer(orcaRow, "bambu")).toBe(true);
  });

  it("prefers a name match, then any compatible row", () => {
    const rows = [
      row(1, "Generic Orca", "orca", { a: 1 }),
      row(2, "Voron 350 0.4 nozzle", "orca", { a: 2 }),
    ];
    expect(pickProfileForPrinter(rows, "orca", "Voron 350")?.id).toBe(2);
    expect(pickProfileForPrinter(rows, "orca", "Unknown printer")?.id).toBe(1);
    expect(pickProfileForPrinter(rows, "prusa", "Voron 350")).toBeNull();
  });

  it("skips rows with no resolved config", () => {
    const rows = [row(1, "Empty", "orca", null), row(2, "Real", "orca", { a: 1 })];
    expect(pickProfileForPrinter(rows, "orca", null)?.id).toBe(2);
  });

  it("prefers the slicer's own dialect over a readable sibling dialect", () => {
    // Regression: OrcaSlicer can read BambuStudio profiles, so without an
    // explicit dialect ranking a bambu-tagged row could win an orca plate
    // purely by list order.
    const rows = [row(1, "Aaa Bambu 0.2", "bambu", { a: 1 }), row(2, "Zzz Orca 0.2", "orca", { a: 2 })];
    expect(pickProfileForPrinter(rows, "orca", null)?.id).toBe(2);
    expect(pickProfileForPrinter(rows, "bambu", null)?.id).toBe(1);
  });

  it("prefers an imported dialect profile over a portable pp_native starter", () => {
    const rows = [
      row(1, "PP Starter 0.2", "pp_native", { a: 1 }),
      row(2, "Imported Orca 0.2", "orca", { a: 2 }),
    ];
    expect(pickProfileForPrinter(rows, "orca", null)?.id).toBe(2);
    // pp_native is the only prusa-compatible row here, so it still gets used.
    expect(pickProfileForPrinter(rows, "prusa", null)?.id).toBe(1);
  });

  it("treats untagged rows (filament profiles) as portable across slicers", () => {
    const rows = [row(1, "Generic PLA", null, { filament_type: "PLA" })];
    for (const slicer of ["orca", "prusa", "bambu"] as const) {
      expect(pickProfileForPrinter(rows, slicer, null)?.id).toBe(1);
    }
  });
});

describe("resolveFlatConfigsForPrinter", () => {
  it("builds machine/process/filament docs matching the chosen slicer", () => {
    withRepo((repo, sqlite) => {
      seedProfiles(sqlite);

      const orca = resolveFlatConfigsForPrinter(repo, printer({ name: "Voron 350" }), "orca");
      expect(Object.keys(orca.configs).sort()).toEqual(["filament", "machine", "process"]);
      expect(orca.configs.machine).toMatchObject({ printer_model: "Voron350" });
      expect(orca.configs.process).toMatchObject({ layer_height: "0.2" });
      expect(orca.sources.machine?.name).toBe("Voron 350 0.4");
      // The imported orca-tagged process beats the bundled pp_native starters.
      expect(orca.sources.process?.name).toBe("Imported Orca 0.2");

      const prusa = resolveFlatConfigsForPrinter(repo, printer({ name: "Prusa XL" }), "prusa");
      expect(prusa.configs.machine).toMatchObject({ printer_model: "XL" });
      expect(prusa.sources.process?.name).toBe("Imported Prusa 0.2");

      const bambu = resolveFlatConfigsForPrinter(repo, printer({ name: "Bambu X1C" }), "bambu");
      expect(bambu.configs.machine).toMatchObject({ printer_model: "X1C" });
      expect(bambu.sources.process?.name).toBe("Imported Bambu 0.2");
    });
  });

  it("emits one filament doc per loaded slot, matched by slot label", () => {
    withRepo((repo, sqlite) => {
      seedProfiles(sqlite);
      const multi = printer({
        name: "Voron 350",
        max_filament_slots: 2,
        loaded_filaments: [
          { slot: 1, filament_color_id: null, label: "Imported PETG" },
          { slot: 2, filament_color_id: null, label: "Imported PLA" },
        ],
      });
      const resolved = resolveFlatConfigsForPrinter(repo, multi, "orca");
      expect(resolved.configs.filament).toMatchObject({ filament_type: "PETG" });
      expect(resolved.configs.filament_2).toMatchObject({ filament_type: "PLA" });
      // Filament keys must contain "filament" so the sidecar routes them to
      // --load-filaments instead of --load-settings.
      for (const key of Object.keys(resolved.configs)) {
        if (key.startsWith("filament")) expect(key).toContain("filament");
      }
    });
  });

  it("warns when the machine profile was picked without a name match", () => {
    withRepo((repo, sqlite) => {
      seedProfiles(sqlite);
      // "Ender 3" matches no imported printer profile, so one is substituted —
      // that substitution must be visible, not silent.
      const resolved = resolveFlatConfigsForPrinter(repo, printer({ name: "Ender 3" }), "orca");
      expect(resolved.configs.machine).toBeDefined();
      expect(resolved.warnings.some((w) => w.includes('No printer profile named like "Ender 3"'))).toBe(
        true,
      );
      // An exact match must NOT produce that warning.
      const exact = resolveFlatConfigsForPrinter(repo, printer({ name: "Voron 350" }), "orca");
      expect(exact.warnings.some((w) => w.includes("No printer profile named like"))).toBe(false);
    });
  });

  it("resolves the portable starter machine profile when no dedicated printer profile is importable", () => {
    withRepo((repo) => {
      // Starter seeding creates printer + process + filament rows (see
      // seed-starter-profiles.ts), so a PrusaXL request with no imported
      // Prusa-specific machine profile still resolves against the portable
      // "Generic FDM Machine" pp_native starter rather than leaving the
      // machine doc missing entirely (the old gap that made OrcaSlicer/
      // BambuStudio reject the process preset as incompatible).
      const resolved = resolveFlatConfigsForPrinter(repo, printer({ name: "Prusa XL" }), "prusa");
      expect(resolved.warnings.some((w) => w.includes('No printer profile named like "Prusa XL"'))).toBe(
        true,
      );
      expect(resolved.configs.machine).toBeDefined();
      expect(resolved.configs.process).toBeDefined();
      expect(resolved.configs.filament).toBeDefined();
    });
  });
});
