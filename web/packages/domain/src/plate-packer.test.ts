import { describe, expect, it, vi } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { PartCopy } from "./checkoff-missing.js";
import {
  classifyHeightBand,
  packCopiesGrouped,
  packCopiesGroupedByHeightBand,
  packCopiesOnPrinter,
} from "./plate-packer.js";
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

  it("splits overflow onto a second plate", () => {
    const dir = mkdtempSync(join(tmpdir(), "pp-pack-overflow-"));
    const stl = join(dir, "bracket.stl");
    writeFileSync(stl, MINI_STL);
    const printer: PrinterMachine = {
      id: "tiny",
      name: "Tiny",
      bed_width_mm: 20,
      bed_depth_mm: 20,
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
      quantityAuto: 2,
      partSlug: "bracket",
      included: true,
      quantityOverride: null,
      notes: "",
      geometrySame: null,
      absolutePath: stl,
    };
    const copies: PartCopy[] = [
      { part, unit: 1 },
      { part, unit: 2 },
    ];
    const [plates, warnings] = packCopiesOnPrinter(printer, copies);
    expect(plates).toHaveLength(2);
    expect(plates[0].items).toHaveLength(1);
    expect(plates[1].items).toHaveLength(1);
    expect(warnings.some((w) => /too large/.test(w))).toBe(false);
    rmSync(dir, { recursive: true, force: true });
  });

  it("warns when a part is larger than the bed", () => {
    const dir = mkdtempSync(join(tmpdir(), "pp-pack-large-"));
    const stl = join(dir, "bracket.stl");
    writeFileSync(stl, MINI_STL);
    const printer: PrinterMachine = {
      id: "tiny",
      name: "Tiny",
      bed_width_mm: 12,
      bed_depth_mm: 12,
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
    const [plates, warnings] = packCopiesOnPrinter(printer, [{ part, unit: 1 }]);
    expect(plates).toEqual([]);
    expect(warnings.some((w) => /too large for Tiny bed/.test(w))).toBe(true);
    rmSync(dir, { recursive: true, force: true });
  });

  it("warns when part height exceeds bed_height_mm", () => {
    const dir = mkdtempSync(join(tmpdir(), "pp-pack-z-"));
    const stl = join(dir, "tall.stl");
    writeFileSync(stl, stlWithHeight(40));
    const printer: PrinterMachine = {
      id: "short-z",
      name: "ShortZ",
      bed_width_mm: 200,
      bed_depth_mm: 200,
      bed_height_mm: 20,
      margin_mm: 4,
      max_filament_slots: 1,
      loaded_filaments: [{ slot: 1, filament_color_id: null, label: "" }],
    };
    const part: MergePart = {
      matchKey: "tall.stl",
      relativePath: "tall.stl",
      filename: "tall.stl",
      sourceLayer: "base:repo",
      status: "included",
      role: "primary",
      quantityAuto: 1,
      partSlug: "tall",
      included: true,
      quantityOverride: null,
      notes: "",
      geometrySame: null,
      absolutePath: stl,
    };
    const [plates, warnings] = packCopiesOnPrinter(printer, [{ part, unit: 1 }]);
    expect(plates).toHaveLength(1);
    expect(warnings.some((w) => /height 40 mm exceeds ShortZ Z limit 20 mm/.test(w))).toBe(true);
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

function makePrinter(overrides: Partial<PrinterMachine> = {}): PrinterMachine {
  return {
    id: "p1",
    name: "Test",
    bed_width_mm: 200,
    bed_depth_mm: 200,
    bed_height_mm: 500,
    margin_mm: 4,
    max_filament_slots: 1,
    loaded_filaments: [{ slot: 1, filament_color_id: null, label: "" }],
    ...overrides,
  };
}

function makePartCopyAtHeight(
  dir: string,
  name: string,
  heightMm: number,
): PartCopy {
  const stl = join(dir, name);
  writeFileSync(stl, stlWithHeight(heightMm));
  const part: MergePart = {
    matchKey: name,
    relativePath: name,
    filename: name,
    sourceLayer: "base:repo",
    status: "included",
    role: "primary",
    quantityAuto: 1,
    partSlug: name.replace(/\.stl$/, ""),
    included: true,
    quantityOverride: null,
    notes: "",
    geometrySame: null,
    absolutePath: stl,
  };
  return { part, unit: 1 };
}

describe("packCopiesGroupedByHeightBand", () => {
  it("groups parts into separate plates per height band, ordered flat to very-tall", () => {
    const dir = mkdtempSync(join(tmpdir(), "pp-band-group-"));
    try {
      const printer = makePrinter();
      const copies: PartCopy[] = [
        makePartCopyAtHeight(dir, "tall.stl", 200),
        makePartCopyAtHeight(dir, "flat.stl", 5),
        makePartCopyAtHeight(dir, "medium.stl", 100),
      ];
      const [plates, warnings] = packCopiesGroupedByHeightBand(printer, copies);
      expect(warnings).toEqual([]);
      // Each band gets its own plate since each band has exactly one part here.
      expect(plates.length).toBe(3);
      expect(plates.map((p) => p.group_label)).toEqual([
        "Flat (<10mm)",
        "Medium (50–150mm)",
        "Tall (150–300mm)",
      ]);
      expect(plates[0].items[0].heightBand).toBe("flat");
      expect(plates[1].items[0].heightBand).toBe("medium");
      expect(plates[2].items[0].heightBand).toBe("tall");
      // Plate indices renumbered sequentially across bands.
      expect(plates.map((p) => p.index)).toEqual([1, 2, 3]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("packs multiple parts of the same band onto shared plate(s)", () => {
    const dir = mkdtempSync(join(tmpdir(), "pp-band-samegroup-"));
    try {
      const printer = makePrinter();
      const copies: PartCopy[] = [
        makePartCopyAtHeight(dir, "a.stl", 20),
        makePartCopyAtHeight(dir, "b.stl", 30),
      ];
      const [plates] = packCopiesGroupedByHeightBand(printer, copies);
      expect(plates.length).toBe(1);
      expect(plates[0].group_label).toBe("Short (10–50mm)");
      expect(plates[0].items.length).toBe(2);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("surfaces STL load errors as warnings without dropping other bands", () => {
    const dir = mkdtempSync(join(tmpdir(), "pp-band-err-"));
    try {
      const printer = makePrinter();
      const goodCopy = makePartCopyAtHeight(dir, "good.stl", 20);
      const badPart: MergePart = {
        matchKey: "missing.stl",
        relativePath: "missing.stl",
        filename: "missing.stl",
        sourceLayer: "base:repo",
        status: "included",
        role: "primary",
        quantityAuto: 1,
        partSlug: "missing",
        included: true,
        quantityOverride: null,
        notes: "",
        geometrySame: null,
        absolutePath: null,
      };
      const [plates, warnings] = packCopiesGroupedByHeightBand(printer, [
        goodCopy,
        { part: badPart, unit: 1 },
      ]);
      expect(warnings.some((w) => w.includes("Missing STL"))).toBe(true);
      expect(plates.length).toBe(1);
      expect(plates[0].items.length).toBe(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("packCopiesGrouped dispatch", () => {
  it("dispatches to height-band grouping when strategy is height_band", () => {
    const dir = mkdtempSync(join(tmpdir(), "pp-dispatch-"));
    try {
      const printer = makePrinter();
      const copies: PartCopy[] = [makePartCopyAtHeight(dir, "part.stl", 5)];
      const [plates] = packCopiesGrouped("height_band", printer, copies);
      expect(plates[0].group_label).toBe("Flat (<10mm)");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("dispatches to location grouping by default", () => {
    const dir = mkdtempSync(join(tmpdir(), "pp-dispatch-loc-"));
    try {
      const printer = makePrinter();
      const copies: PartCopy[] = [makePartCopyAtHeight(dir, "part.stl", 5)];
      const [plates] = packCopiesGrouped("location", printer, copies);
      // Location grouping labels by filament/repo/folder, not by height band.
      expect(plates[0].group_label).not.toBe("Flat (<10mm)");
      expect(plates[0].group_label).toContain("repo");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("plate height variance warning", () => {
  it("returns a structured warning without writing to the console", () => {
    const dir = mkdtempSync(join(tmpdir(), "pp-variance-"));
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      const printer = makePrinter();
      // shortest = 10mm, tallest = 100mm -> variance 90mm > 2*10=20mm -> should warn.
      const copies: PartCopy[] = [
        makePartCopyAtHeight(dir, "short.stl", 10),
        makePartCopyAtHeight(dir, "tall.stl", 100),
      ];
      const [, warnings] = packCopiesOnPrinter(printer, copies);
      expect(warnings.some((w) => w.includes("height variance"))).toBe(true);
      expect(consoleWarn).not.toHaveBeenCalled();
    } finally {
      consoleWarn.mockRestore();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("does not warn when height variance is within 2x the shortest part", () => {
    const dir = mkdtempSync(join(tmpdir(), "pp-novariance-"));
    try {
      const printer = makePrinter();
      // shortest = 20mm, tallest = 30mm -> variance 10mm <= 2*20=40mm -> no warning.
      const copies: PartCopy[] = [
        makePartCopyAtHeight(dir, "a.stl", 20),
        makePartCopyAtHeight(dir, "b.stl", 30),
      ];
      const [, warnings] = packCopiesOnPrinter(printer, copies);
      expect(warnings.some((w) => w.includes("height variance"))).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("does not warn for a single-part plate (no variance possible)", () => {
    const dir = mkdtempSync(join(tmpdir(), "pp-singlevariance-"));
    try {
      const printer = makePrinter();
      const copies: PartCopy[] = [makePartCopyAtHeight(dir, "solo.stl", 200)];
      const [, warnings] = packCopiesOnPrinter(printer, copies);
      expect(warnings.some((w) => w.includes("height variance"))).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("warns per-plate for every active grouping strategy, including height_band", () => {
    const dir = mkdtempSync(join(tmpdir(), "pp-variance-strategy-"));
    try {
      const printer = makePrinter();
      // Both fall in the "short" band (10-50mm) but still vary > 2x within that plate.
      const copies: PartCopy[] = [
        makePartCopyAtHeight(dir, "a.stl", 10),
        makePartCopyAtHeight(dir, "b.stl", 45),
      ];
      const [, warnings] = packCopiesGroupedByHeightBand(printer, copies);
      expect(warnings.some((w) => w.includes("height variance"))).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
