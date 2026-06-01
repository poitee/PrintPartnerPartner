import { describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { PartCopy } from "./checkoff-missing.js";
import { packCopiesOnPrinter } from "./plate-packer.js";
import type { PrinterMachine } from "./filament-assigner.js";
import type { MergePart } from "./merge.js";

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

describe("plate packer", () => {
  it("packs small parts onto one plate", () => {
    const dir = mkdtempSync(join(tmpdir(), "pp-pack-"));
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
    const part: MergePart = {
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
    };
    const copies: PartCopy[] = [{ part, unit: 1 }];
    const [plates, warnings] = packCopiesOnPrinter(printer, copies);
    expect(warnings).toEqual([]);
    expect(plates.length).toBeGreaterThanOrEqual(1);
    expect(plates[0].items.length).toBe(1);
    rmSync(dir, { recursive: true, force: true });
  });
});
