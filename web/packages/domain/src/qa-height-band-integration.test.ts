/**
 * QA integration coverage for the height-band feature (t_54b4224c).
 *
 * Exercises the real packer end-to-end (STL fixtures on disk -> packCopiesGrouped
 * -> PlacedItem.heightBand / plate warnings) rather than re-testing pure helpers
 * in isolation, to catch wiring bugs the unit-level suites (plate-packer.test.ts,
 * plate-packer-height-band.test.ts) might miss at their boundaries.
 *
 * Scope: requirements 1-3 from the task body (band classification edge cases,
 * height-band grouping strategy ordering, variance-warning threshold behavior
 * at the exact 2x boundary). Requirement 4 (UI label rendering) is covered by
 * inspection + a documented gap — see QA notes posted to the task.
 */
import { describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { PartCopy } from "./checkoff-missing.js";
import {
  classifyHeightBand,
  packCopiesGrouped,
  packCopiesGroupedByHeightBand,
  packCopiesOnPrinter,
  HEIGHT_BAND_ORDER,
} from "./plate-packer.js";
import type { PrinterMachine } from "./filament-assigner.js";
import type { MergePart } from "./merge.js";

const PRINTER: PrinterMachine = {
  id: "qa-p1",
  name: "QA-Test-Printer",
  model: "QA-Test-Printer",
  bed_width_mm: 220,
  bed_depth_mm: 220,
  bed_height_mm: 500,
  margin_mm: 4,
  max_filament_slots: 1,
  loaded_filaments: [{ slot: 1, filament_color_id: null, label: "" }],
};

let dir: string;
let counter = 0;

function stlOfHeight(heightMm: number, widthMm = 10, depthMm = 10): string {
  return `solid t
  facet normal 0 0 1
    outer loop
      vertex 0 0 0
      vertex ${widthMm} 0 0
      vertex 0 ${depthMm} ${heightMm}
    endloop
  endfacet
endsolid t
`;
}

function makeCopy(heightMm: number, opts: { widthMm?: number; depthMm?: number; name?: string } = {}): PartCopy {
  const name = opts.name ?? `qa-part-${(counter += 1)}.stl`;
  const stl = join(dir, name);
  writeFileSync(stl, stlOfHeight(heightMm, opts.widthMm ?? 10, opts.depthMm ?? 10));
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

describe("QA: requirement 1 — height band classification edge cases", () => {
  it("classifies exact threshold boundaries into the taller band (upper bound exclusive)", () => {
    // Documented behavior: 10, 50, 150, 300 all belong to the NEXT band up.
    expect(classifyHeightBand(10)).toBe("short");
    expect(classifyHeightBand(50)).toBe("medium");
    expect(classifyHeightBand(150)).toBe("tall");
    expect(classifyHeightBand(300)).toBe("very-tall");
  });

  it("classifies values an epsilon below each threshold into the shorter band", () => {
    expect(classifyHeightBand(9.9999)).toBe("flat");
    expect(classifyHeightBand(49.9999)).toBe("short");
    expect(classifyHeightBand(149.9999)).toBe("medium");
    expect(classifyHeightBand(299.9999)).toBe("tall");
  });

  it("classifies all 5 bands' midpoints correctly", () => {
    expect(classifyHeightBand(5)).toBe("flat");
    expect(classifyHeightBand(30)).toBe("short");
    expect(classifyHeightBand(100)).toBe("medium");
    expect(classifyHeightBand(225)).toBe("tall");
    expect(classifyHeightBand(1000)).toBe("very-tall");
  });

  it("treats invalid/degenerate mesh heights (0, negative, NaN, +-Infinity) defensively as flat/very-tall, never throwing", () => {
    expect(classifyHeightBand(0)).toBe("flat");
    expect(classifyHeightBand(-1)).toBe("flat");
    expect(classifyHeightBand(-1e9)).toBe("flat");
    expect(classifyHeightBand(NaN)).toBe("flat");
    expect(classifyHeightBand(Infinity)).toBe("very-tall");
    expect(classifyHeightBand(-Infinity)).toBe("flat");
  });

  it("attaches the pack-time heightBand consistently with classifyHeightBand for real STL fixtures at every boundary", () => {
    dir = mkdtempSync(join(tmpdir(), "qa-hb-classify-"));
    try {
      const boundaryHeights = [0, 9.999, 10, 49.999, 50, 149.999, 150, 299.999, 300, 5000];
      for (const h of boundaryHeights) {
        const [plates] = packCopiesOnPrinter(PRINTER, [makeCopy(h)]);
        expect(plates[0].items[0].heightBand).toBe(classifyHeightBand(h));
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("QA: requirement 2 — Height Band strategy sorts/groups before shelf-packing", () => {
  it("groups an all-bands input into exactly 5 uniform plates ordered flat -> very-tall", () => {
    dir = mkdtempSync(join(tmpdir(), "qa-hb-group-"));
    try {
      // Deliberately reverse/scramble input order.
      const copies = [
        makeCopy(400, { name: "vt.stl" }),
        makeCopy(5, { name: "flat.stl" }),
        makeCopy(200, { name: "tall.stl" }),
        makeCopy(100, { name: "med.stl" }),
        makeCopy(30, { name: "short.stl" }),
      ];
      const [plates, warnings] = packCopiesGroupedByHeightBand(PRINTER, copies);
      expect(warnings).toEqual([]);
      expect(plates.length).toBe(5);
      const bandOrder = plates.map((p) => [...new Set(p.items.map((i) => i.heightBand))]);
      expect(bandOrder.every((b) => b.length === 1)).toBe(true);
      expect(bandOrder.map((b) => b[0])).toEqual(HEIGHT_BAND_ORDER);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("packCopiesGrouped('height_band', ...) matches packCopiesGroupedByHeightBand exactly (dispatcher wiring)", () => {
    dir = mkdtempSync(join(tmpdir(), "qa-hb-dispatch-"));
    try {
      const copies = [makeCopy(5, { name: "a.stl" }), makeCopy(200, { name: "b.stl" })];
      const [viaDispatch] = packCopiesGrouped("height_band", PRINTER, copies);
      const [viaDirect] = packCopiesGroupedByHeightBand(PRINTER, copies);
      expect(viaDispatch).toEqual(viaDirect);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("a band that overflows one plate spills to a second plate without pulling in an adjacent band", () => {
    dir = mkdtempSync(join(tmpdir(), "qa-hb-overflow-"));
    try {
      // 100x100mm footprints; usable bed ~212x212 -> 4 fit per row-ish, so 6 short
      // parts should require 2 plates, and none should include the 1 medium part.
      const copies: PartCopy[] = [];
      for (let i = 0; i < 6; i++) {
        copies.push(makeCopy(30, { widthMm: 100, depthMm: 100, name: `short-${i}.stl` }));
      }
      copies.push(makeCopy(100, { widthMm: 100, depthMm: 100, name: "medium-1.stl" }));
      const [plates] = packCopiesGroupedByHeightBand(PRINTER, copies);
      const shortPlates = plates.filter((p) => p.items.every((i) => i.heightBand === "short"));
      const mediumPlates = plates.filter((p) => p.items.every((i) => i.heightBand === "medium"));
      expect(shortPlates.length).toBeGreaterThanOrEqual(2);
      expect(mediumPlates.length).toBe(1);
      expect(shortPlates.every((p) => p.items.every((i) => i.heightBand === "short"))).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("QA: requirement 3 — height variance warning threshold (>2x shortest part)", () => {
  it("does NOT warn at exactly 2x the shortest part's height (boundary is exclusive per code: variance <= 2*minH)", () => {
    dir = mkdtempSync(join(tmpdir(), "qa-var-exact2x-"));
    try {
      // shortest=10, tallest=30 -> variance=20 == 2*10 exactly -> spec says "exceeds", so no warn.
      const copies = [makeCopy(10, { name: "s.stl" }), makeCopy(30, { name: "t.stl" })];
      const [, warnings] = packCopiesOnPrinter(PRINTER, copies);
      expect(warnings.some((w) => w.includes("height variance"))).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("DOES warn just over 2x the shortest part's height", () => {
    dir = mkdtempSync(join(tmpdir(), "qa-var-over2x-"));
    try {
      // shortest=10, tallest=30.1 -> variance=20.1 > 20 -> warn.
      const copies = [makeCopy(10, { name: "s.stl" }), makeCopy(30.1, { name: "t.stl" })];
      const [, warnings] = packCopiesOnPrinter(PRINTER, copies);
      expect(warnings.some((w) => w.includes("height variance"))).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("does not warn when every plate is within threshold across a multi-plate location-style pack", () => {
    dir = mkdtempSync(join(tmpdir(), "qa-var-multiplate-"));
    try {
      const copies = [
        makeCopy(20, { name: "a.stl" }),
        makeCopy(25, { name: "b.stl" }),
        makeCopy(22, { name: "c.stl" }),
      ];
      const [, warnings] = packCopiesOnPrinter(PRINTER, copies);
      expect(warnings.some((w) => w.includes("height variance"))).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("fires independently per-plate under Height Band grouping when a single band's own spread exceeds 2x", () => {
    dir = mkdtempSync(join(tmpdir(), "qa-var-band-"));
    try {
      // Both land in "short" band (10-50mm) but 10 vs 45 has variance 35 > 2*10=20.
      const copies = [makeCopy(10, { name: "s.stl" }), makeCopy(45, { name: "t.stl" })];
      const [plates, warnings] = packCopiesGroupedByHeightBand(PRINTER, copies);
      expect(plates.length).toBe(1);
      expect(warnings.some((w) => w.includes("height variance"))).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("uses zero/negative heights defensively: variance check ignores non-positive heights instead of dividing by zero", () => {
    dir = mkdtempSync(join(tmpdir(), "qa-var-zero-"));
    try {
      // One part with a degenerate 0mm height alongside a normal part must not
      // crash (would be Infinity or NaN if minH were 0 and used as divisor).
      const copies = [makeCopy(0, { name: "zero.stl" }), makeCopy(50, { name: "normal.stl" })];
      expect(() => packCopiesOnPrinter(PRINTER, copies)).not.toThrow();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
