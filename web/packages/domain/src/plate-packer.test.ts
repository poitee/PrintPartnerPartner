import { describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { PartCopy } from "./checkoff-missing.js";
import { classifyHeightBand, packCopiesOnPrinter } from "./plate-packer.js";
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

/**
 * Build a minimal ASCII STL whose Z extent is exactly `heightMm` (and whose
 * footprint is a fixed 10x10 mm), so packCopiesOnPrinter sees a known
 * bounds.heightMm. heightMm is maxZ - minZ, so a single facet reaching up to
 * `heightMm` is enough.
 */
function stlWithHeight(heightMm: number): string {
  return `solid t
  facet normal 0 0 1
    outer loop
      vertex 0 0 0
      vertex 10 0 0
      vertex 0 10 ${heightMm}
    endloop
  endfacet
endsolid t
`;
}

function packSinglePartOfHeight(heightMm: number) {
  const dir = mkdtempSync(join(tmpdir(), "pp-band-"));
  try {
    const stl = join(dir, "part.stl");
    writeFileSync(stl, stlWithHeight(heightMm));
    const printer: PrinterMachine = {
      id: "p1",
      name: "Test",
      bed_width_mm: 200,
      bed_depth_mm: 200,
      bed_height_mm: 500,
      margin_mm: 4,
      max_filament_slots: 1,
      loaded_filaments: [{ slot: 1, filament_color_id: null, label: "" }],
    };
    const part: MergePart = {
      matchKey: "part.stl",
      relativePath: "part.stl",
      filename: "part.stl",
      sourceLayer: "base:repo",
      status: "included",
      role: "primary",
      quantityAuto: 1,
      partSlug: "part",
      included: true,
      quantityOverride: null,
      notes: "",
      geometrySame: null,
      absolutePath: stl,
    };
    const copies: PartCopy[] = [{ part, unit: 1 }];
    const [plates] = packCopiesOnPrinter(printer, copies);
    return plates[0].items[0];
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("packCopiesOnPrinter heightBand attachment", () => {
  it("attaches the correct heightBand to each placed item at pack time", () => {
    // One representative height per band, packed through the real packer so
    // this covers the wiring (bounds.heightMm -> classifyHeightBand -> item),
    // not just the pure classifier.
    expect(packSinglePartOfHeight(5).heightBand).toBe("flat");
    expect(packSinglePartOfHeight(25).heightBand).toBe("short");
    expect(packSinglePartOfHeight(100).heightBand).toBe("medium");
    expect(packSinglePartOfHeight(200).heightBand).toBe("tall");
    expect(packSinglePartOfHeight(400).heightBand).toBe("very-tall");
  });

  it("keeps heightBand consistent with the item's own height_mm", () => {
    const item = packSinglePartOfHeight(72);
    expect(item.height_mm).toBeCloseTo(72, 5);
    expect(item.heightBand).toBe(classifyHeightBand(item.height_mm));
  });
});

describe("classifyHeightBand", () => {
  it("classifies typical part heights", () => {
    expect(classifyHeightBand(5)).toBe("flat");
    expect(classifyHeightBand(25)).toBe("short");
    expect(classifyHeightBand(100)).toBe("medium");
    expect(classifyHeightBand(200)).toBe("tall");
    expect(classifyHeightBand(400)).toBe("very-tall");
  });

  it("treats each band's upper threshold as exclusive (boundary belongs to the taller band)", () => {
    expect(classifyHeightBand(10)).toBe("short");
    expect(classifyHeightBand(50)).toBe("medium");
    expect(classifyHeightBand(150)).toBe("tall");
    expect(classifyHeightBand(300)).toBe("very-tall");
  });

  it("classifies values just below each threshold into the shorter band", () => {
    expect(classifyHeightBand(9.999)).toBe("flat");
    expect(classifyHeightBand(49.999)).toBe("short");
    expect(classifyHeightBand(149.999)).toBe("medium");
    expect(classifyHeightBand(299.999)).toBe("tall");
  });

  it("handles zero and negative heights as flat", () => {
    expect(classifyHeightBand(0)).toBe("flat");
    expect(classifyHeightBand(-5)).toBe("flat");
    expect(classifyHeightBand(-0.001)).toBe("flat");
  });

  it("handles non-finite input defensively", () => {
    expect(classifyHeightBand(NaN)).toBe("flat");
    expect(classifyHeightBand(Infinity)).toBe("very-tall");
    expect(classifyHeightBand(-Infinity)).toBe("flat");
  });
});
