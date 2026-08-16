/**
 * Tests for the "Height Band" grouping strategy (packCopiesGroupedByHeightBand
 * and the packCopiesGrouped dispatcher).
 *
 * Lives in its own file rather than in plate-packer.test.ts because the height
 * band grouping work landed alongside concurrent edits to that file; keeping
 * the grouping-strategy suite separate keeps the two independently reviewable.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { PartCopy } from "./checkoff-missing.js";
import {
  HEIGHT_BAND_LABELS,
  classifyHeightBand,
  packCopiesGrouped,
  packCopiesGroupedByHeightBand,
  packCopiesGroupedByLocation,
  type HeightBand,
  type PlateLayout,
} from "./plate-packer.js";
import type { PrinterMachine } from "./filament-assigner.js";
import type { MergePart } from "./merge.js";

/**
 * Expected shortest -> tallest band order, written out literally rather than
 * imported from the module under test: asserting the production constant
 * against itself would pass even if the order were wrong, and the internal
 * ordering constant is not part of the package's public API.
 */
const EXPECTED_BAND_ORDER: HeightBand[] = ["flat", "short", "medium", "tall", "very-tall"];

const PRINTER: PrinterMachine = {
  id: "p1",
  name: "Test",
  bed_width_mm: 200,
  bed_depth_mm: 200,
  bed_height_mm: 500,
  margin_mm: 4,
  max_filament_slots: 1,
  loaded_filaments: [{ slot: 1, filament_color_id: null, label: "" }],
};

/**
 * A single-facet ASCII STL with an exact bounding box of width x depth x height.
 * Vertices (0,0,0), (w,0,0), (0,d,h) give minZ=0/maxZ=h, so bounds.heightMm === h.
 */
function stlOfSize(widthMm: number, depthMm: number, heightMm: number): string {
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

let dir: string;
let fileCounter = 0;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "pp-band-group-"));
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

type CopyOpts = {
  heightMm: number;
  widthMm?: number;
  depthMm?: number;
  name?: string;
  /** Drives packCopiesGroupedByLocation's grouping key (repo segment). */
  sourceLayer?: string;
  relativePath?: string;
  /** When true, no STL is written, so the mesh fails to load. */
  missingFile?: boolean;
};

function makeCopy(opts: CopyOpts): PartCopy {
  const { heightMm, widthMm = 10, depthMm = 10, missingFile = false } = opts;
  const name = opts.name ?? `part-${(fileCounter += 1)}.stl`;
  const stl = join(dir, name);
  if (!missingFile) writeFileSync(stl, stlOfSize(widthMm, depthMm, heightMm));
  const part: MergePart = {
    matchKey: name,
    relativePath: opts.relativePath ?? name,
    filename: name,
    sourceLayer: opts.sourceLayer ?? "base:repo",
    status: "included",
    role: "primary",
    quantityAuto: 1,
    partSlug: name.replace(/\.stl$/, ""),
    included: true,
    quantityOverride: null,
    notes: "",
    geometrySame: null,
    absolutePath: missingFile ? join(dir, "does-not-exist.stl") : stl,
  };
  return { part, unit: 1 };
}

/** The set of distinct height bands present on a plate. */
function bandsOnPlate(plate: PlateLayout): HeightBand[] {
  return [...new Set(plate.items.map((i) => i.heightBand))];
}

function filenamesOnPlate(plate: PlateLayout): string[] {
  return plate.items.map((i) => (i.copy.part as MergePart).filename);
}

describe("packCopiesGroupedByHeightBand", () => {
  it("puts parts from a single band on each plate for multi-band input", () => {
    // One part per band, deliberately interleaved in the input order so a
    // packer that ignored bands would mix them onto one plate (all 5 fit on
    // a single 192x192 usable bed at a 10x10 footprint).
    const copies = [
      makeCopy({ heightMm: 200, name: "tall-a.stl" }), // tall
      makeCopy({ heightMm: 5, name: "flat-a.stl" }), // flat
      makeCopy({ heightMm: 400, name: "verytall-a.stl" }), // very-tall
      makeCopy({ heightMm: 100, name: "medium-a.stl" }), // medium
      makeCopy({ heightMm: 25, name: "short-a.stl" }), // short
    ];

    const [plates, warnings] = packCopiesGroupedByHeightBand(PRINTER, copies);

    expect(warnings).toEqual([]);
    // Five distinct bands must not be interleaved: one plate per band.
    expect(plates.length).toBe(5);
    for (const plate of plates) {
      expect(bandsOnPlate(plate)).toHaveLength(1);
    }
    // Bands come out shortest -> tallest, each labelled with its band.
    expect(plates.map((p) => bandsOnPlate(p)[0])).toEqual(EXPECTED_BAND_ORDER);
    expect(plates.map((p) => p.group_label)).toEqual(
      EXPECTED_BAND_ORDER.map((b) => HEIGHT_BAND_LABELS[b]),
    );
    expect(plates.map((p) => filenamesOnPlate(p)[0])).toEqual([
      "flat-a.stl",
      "short-a.stl",
      "medium-a.stl",
      "tall-a.stl",
      "verytall-a.stl",
    ]);
  });

  it("keeps multiple parts of the same band together on one plate", () => {
    const copies = [
      makeCopy({ heightMm: 5, name: "flat-1.stl" }),
      makeCopy({ heightMm: 120, name: "med-1.stl" }),
      makeCopy({ heightMm: 7, name: "flat-2.stl" }),
      makeCopy({ heightMm: 130, name: "med-2.stl" }),
      makeCopy({ heightMm: 9, name: "flat-3.stl" }),
    ];

    const [plates] = packCopiesGroupedByHeightBand(PRINTER, copies);

    expect(plates.length).toBe(2);
    expect(bandsOnPlate(plates[0])).toEqual(["flat"]);
    expect(filenamesOnPlate(plates[0]).sort()).toEqual([
      "flat-1.stl",
      "flat-2.stl",
      "flat-3.stl",
    ]);
    expect(bandsOnPlate(plates[1])).toEqual(["medium"]);
    expect(filenamesOnPlate(plates[1]).sort()).toEqual(["med-1.stl", "med-2.stl"]);
  });

  it("assigns sequential plate indices across bands", () => {
    const copies = [
      makeCopy({ heightMm: 5, name: "idx-flat.stl" }),
      makeCopy({ heightMm: 25, name: "idx-short.stl" }),
      makeCopy({ heightMm: 100, name: "idx-med.stl" }),
    ];
    const [plates] = packCopiesGroupedByHeightBand(PRINTER, copies);
    expect(plates.map((p) => p.index)).toEqual([1, 2, 3]);
    expect(plates.every((p) => p.printer_id === PRINTER.id)).toBe(true);
  });

  it("spills one band across several plates without pulling in another band", () => {
    // 80x80 footprints: 4 fit per 192x192 usable bed, so 5 short parts need
    // 2 plates. The medium part must not be used to top up the second plate.
    const copies = [
      ...Array.from({ length: 5 }, (_, i) =>
        makeCopy({ heightMm: 30, widthMm: 80, depthMm: 80, name: `big-short-${i}.stl` }),
      ),
      makeCopy({ heightMm: 100, widthMm: 80, depthMm: 80, name: "big-med.stl" }),
    ];

    const [plates] = packCopiesGroupedByHeightBand(PRINTER, copies);

    expect(plates.length).toBe(3);
    for (const plate of plates) {
      expect(bandsOnPlate(plate)).toHaveLength(1);
    }
    expect(plates.map((p) => bandsOnPlate(p)[0])).toEqual(["short", "short", "medium"]);
    // All five short parts are placed, none absorbed into the medium plate.
    expect(plates[0].items.length + plates[1].items.length).toBe(5);
    expect(filenamesOnPlate(plates[2])).toEqual(["big-med.stl"]);
  });

  it("attaches a heightBand consistent with each item's height", () => {
    const copies = [
      makeCopy({ heightMm: 8, name: "cons-flat.stl" }),
      makeCopy({ heightMm: 220, name: "cons-tall.stl" }),
    ];
    const [plates] = packCopiesGroupedByHeightBand(PRINTER, copies);
    for (const plate of plates) {
      for (const item of plate.items) {
        expect(item.heightBand).toBe(classifyHeightBand(item.height_mm));
      }
    }
  });

  it("returns empty output for empty input", () => {
    expect(packCopiesGroupedByHeightBand(PRINTER, [])).toEqual([[], []]);
  });

  it("surfaces a load error once and still groups the loadable parts", () => {
    const copies = [
      makeCopy({ heightMm: 5, name: "ok-flat.stl" }),
      makeCopy({ heightMm: 5, name: "broken.stl", missingFile: true }),
      makeCopy({ heightMm: 100, name: "ok-med.stl" }),
    ];

    const [plates, warnings] = packCopiesGroupedByHeightBand(PRINTER, copies);

    const loadWarnings = warnings.filter((w) => w.includes("broken.stl"));
    expect(loadWarnings).toHaveLength(1);
    expect(plates.length).toBe(2);
    expect(plates.flatMap(filenamesOnPlate)).toEqual(["ok-flat.stl", "ok-med.stl"]);
  });

  it("does not emit a height variance warning for a uniform-height band", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const copies = [
        makeCopy({ heightMm: 40, name: "var-a.stl" }),
        makeCopy({ heightMm: 40, name: "var-b.stl" }),
      ];
      const [plates, warnings] = packCopiesGroupedByHeightBand(PRINTER, copies);
      expect(plates.length).toBe(1);
      expect(warnings).toEqual([]);
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });
});

describe("packCopiesGrouped dispatch", () => {
  const multiBand = () => [
    makeCopy({ heightMm: 5, name: "d-flat.stl", sourceLayer: "base:repoA", relativePath: "a/d-flat.stl" }),
    makeCopy({ heightMm: 100, name: "d-med.stl", sourceLayer: "base:repoA", relativePath: "a/d-med.stl" }),
    makeCopy({ heightMm: 250, name: "d-tall.stl", sourceLayer: "base:repoA", relativePath: "a/d-tall.stl" }),
  ];

  it("routes height_band to the height band packer", () => {
    const copies = multiBand();
    const [viaDispatch] = packCopiesGrouped("height_band", PRINTER, copies);
    const [viaDirect] = packCopiesGroupedByHeightBand(PRINTER, copies);
    expect(viaDispatch.map((p) => p.group_label)).toEqual(viaDirect.map((p) => p.group_label));
    expect(viaDispatch.map(filenamesOnPlate)).toEqual(viaDirect.map(filenamesOnPlate));
    expect(viaDispatch.every((p) => bandsOnPlate(p).length === 1)).toBe(true);
  });

  it("leaves the location strategy unaffected", () => {
    const copies = multiBand();
    const [viaDispatch, dispatchWarnings] = packCopiesGrouped("location", PRINTER, copies);
    const [viaDirect, directWarnings] = packCopiesGroupedByLocation(PRINTER, copies);

    expect(viaDispatch.map((p) => p.group_label)).toEqual(viaDirect.map((p) => p.group_label));
    expect(viaDispatch.map(filenamesOnPlate)).toEqual(viaDirect.map(filenamesOnPlate));
    expect(dispatchWarnings).toEqual(directWarnings);

    // Location grouping keys on filament + repo + folder, NOT band: these three
    // parts share a group and so share a plate despite spanning three bands.
    expect(viaDispatch.length).toBe(1);
    expect(bandsOnPlate(viaDispatch[0]).sort()).toEqual(["flat", "medium", "tall"]);
    expect(viaDispatch[0].group_label).not.toBe(HEIGHT_BAND_LABELS.flat);
  });
});
