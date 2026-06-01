import { describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { unzipSync } from "fflate";
import {
  exportProfile3mf,
  objectDisplayName,
  sanitize3mfObjectName,
} from "./export-3mf.js";
import type { PrinterMachine } from "./filament-assigner.js";
import type { MergePartExport } from "./filament-assigner.js";

const MINI_STL = `solid t
  facet normal 0 0 1
    outer loop
      vertex 0 0 0
      vertex 10 0 0
      vertex 0 10 0
    endloop
  endfacet
endsolid t
`;

describe("export 3mf", () => {
  it("sanitizes object names", () => {
    expect(sanitize3mfObjectName("parts/bracket.stl")).toBe("bracket.stl");
    expect(sanitize3mfObjectName("weird<name>.stl")).toBe("weird_name_.stl");
  });

  it("names quantity copies", () => {
    const used = new Set<string>();
    expect(objectDisplayName("bracket.stl", 1, used)).toBe("bracket.stl");
    expect(objectDisplayName("bracket.stl", 2, used)).toBe("bracket.stl (2)");
  });

  it("writes valid 3MF zip with model XML", () => {
    const dir = mkdtempSync(join(tmpdir(), "pp-3mf-"));
    const exportsDir = join(dir, "exports");
    const stl = join(dir, "bracket.stl");
    writeFileSync(stl, MINI_STL);
    const printer: PrinterMachine = {
      id: "p1",
      name: "Test",
      bed_width_mm: 200,
      bed_depth_mm: 200,
      bed_height_mm: 200,
      margin_mm: 4,
      max_filament_slots: 1,
      loaded_filaments: [{ slot: 1, filament_color_id: null, label: "" }],
    };
    const part: MergePartExport = {
      matchKey: "bracket.stl",
      relativePath: "bracket.stl",
      filename: "bracket.stl",
      sourceLayer: "base:repo",
      status: "included",
      role: "primary",
      quantityAuto: 1,
      partSlug: "bracket",
      included: true,
      quantityOverride: null,
      notes: "",
      geometrySame: null,
      absolutePath: stl,
      quantityEffective: 1,
    };
    const result = exportProfile3mf("Kit", [part], exportsDir, {
      enabled_printers: [printer],
      layout_mode: "per_plate",
    });
    expect(result.object_count).toBeGreaterThan(0);
    expect(existsSync(result.primary_path)).toBe(true);
    const zip = readFileSync(result.primary_path);
    const files = unzipSync(zip);
    const model = files["3D/3dmodel.model"];
    expect(model).toBeDefined();
    const xml = new TextDecoder().decode(model);
    expect(xml).toContain("<model");
    expect(xml).toContain("<vertex");
    expect(xml).toContain("<triangle");
    rmSync(dir, { recursive: true, force: true });
  });
});
