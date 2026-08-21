/**
 * Wire-contract test for the plate preview the UI plate group cards consume.
 *
 * The web app reads `height_band` off each item in
 * PlateWorkspace.preview[].plates[].items (see api/engine.ts PlateFootprint and
 * lib/plateHeightBand.ts). packPreviewForPrinters → plateLayoutDict →
 * placedItemDict is what produces that field, so this pins the serialization:
 * if the band stops being emitted, every card silently degrades to
 * "Unclassified" instead of failing loudly.
 */

import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  folderKeyFromRelativePath,
  makeGroupKey,
  mergePartsToCopies,
  partFilamentKey,
  repoNameFromSourceLayer,
  type MergePartExport,
  type PrinterMachine,
} from "@print-partner/domain";
import type { AppRepository } from "../db/repository.js";
import { saveFleet } from "./printer-fleet.js";
import { saveKitPrintPlan } from "./print-plan-store.js";
import { buildPlateWorkspace, packPreviewForPrinters } from "./plate-workspace.js";

/** Minimal ASCII STL whose Z-extent is exactly `heightMm`. */
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

function makePrinter(): PrinterMachine {
  return {
    id: "p1",
    name: "Test",
    model: "Test",
    bed_width_mm: 200,
    bed_depth_mm: 200,
    bed_height_mm: 500,
    margin_mm: 4,
    max_filament_slots: 1,
    loaded_filaments: [{ slot: 1, filament_color_id: null, label: "" }],
  };
}

function makePart(
  dir: string,
  name: string,
  heightMm: number,
  extras: Partial<MergePartExport> = {},
): MergePartExport {
  const stl = join(dir, name);
  writeFileSync(stl, stlWithHeight(heightMm));
  return {
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
    ...extras,
  } as MergePartExport;
}

type PreviewItem = { filename: string; height_band?: string; height_mm: number };
type PreviewBed = {
  printer_id: string;
  plates: Array<{ index: number; group_label: string; items: PreviewItem[] }>;
};

/**
 * packPreviewForPrinters keys assignments by group key (filament + repo +
 * folder), not match key — build them the same way groupKeyForCopy does rather
 * than guessing the key format.
 */
function assignEveryCopyTo(
  copies: ReturnType<typeof mergePartsToCopies>,
  printerId: string,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const copy of copies) {
    const part = copy.part as MergePartExport;
    const key = makeGroupKey(
      partFilamentKey(part),
      repoNameFromSourceLayer(part.sourceLayer),
      folderKeyFromRelativePath(part.relativePath),
    );
    out[key] = printerId;
  }
  return out;
}

function platesOf(preview: unknown[]): PreviewBed["plates"] {
  return (preview as PreviewBed[]).flatMap((bed) => bed.plates);
}

describe("packPreviewForPrinters height_band serialization", () => {
  it("emits height_band per item for the location strategy (mixed-band plate)", () => {
    const dir = mkdtempSync(join(tmpdir(), "pp-ws-loc-"));
    try {
      const printer = makePrinter();
      const copies = mergePartsToCopies([
        makePart(dir, "flat.stl", 5),
        makePart(dir, "tall.stl", 200),
      ]);
      const { preview, warnings } = packPreviewForPrinters(
        [printer],
        copies,
        assignEveryCopyTo(copies, printer.id),
        4,
        "location",
      );

      const items = platesOf(preview).flatMap((p) => p.items);
      expect(items.length).toBe(2);
      const byName = new Map(items.map((i) => [i.filename, i]));
      expect(byName.get("flat.stl")?.height_band).toBe("flat");
      expect(byName.get("tall.stl")?.height_band).toBe("tall");
      // These parts share filament/repo/folder, so location grouping puts them
      // on one plate — the mixed-height case the >2x variance warning covers.
      expect(warnings.some((w) => w.includes("height variance"))).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("emits a uniform height_band per plate for the height_band strategy", () => {
    const dir = mkdtempSync(join(tmpdir(), "pp-ws-band-"));
    try {
      const printer = makePrinter();
      const copies = mergePartsToCopies([
        makePart(dir, "flat.stl", 5),
        makePart(dir, "tall.stl", 200),
      ]);
      const { preview } = packPreviewForPrinters(
        [printer],
        copies,
        assignEveryCopyTo(copies, printer.id),
        4,
        "height_band",
      );

      const plates = platesOf(preview);
      // One plate per band, each internally uniform — this is what makes the
      // card badge read a single band name rather than a "Flat–Tall" span.
      expect(plates.length).toBe(2);
      const bandsPerPlate = plates.map((p) => [
        ...new Set(p.items.map((i) => i.height_band)),
      ]);
      expect(bandsPerPlate).toEqual([["flat"], ["tall"]]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("keeps height_band on every item when a plate holds several parts", () => {
    const dir = mkdtempSync(join(tmpdir(), "pp-ws-multi-"));
    try {
      const printer = makePrinter();
      const copies = mergePartsToCopies([
        makePart(dir, "a.stl", 20),
        makePart(dir, "b.stl", 30),
        makePart(dir, "c.stl", 40),
      ]);
      const { preview } = packPreviewForPrinters(
        [printer],
        copies,
        assignEveryCopyTo(copies, printer.id),
        4,
        "height_band",
      );

      const items = platesOf(preview).flatMap((p) => p.items);
      expect(items.length).toBe(3);
      // All three are 10–50mm → all "short", no item missing the field.
      expect(items.map((i) => i.height_band)).toEqual(["short", "short", "short"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("packs Auto groups from loaded filament when assignments are empty", () => {
    const dir = mkdtempSync(join(tmpdir(), "pp-ws-auto-"));
    try {
      const voron: PrinterMachine = {
        ...makePrinter(),
        id: "voron",
        name: "Voron 350",
        loaded_filaments: [{ slot: 1, filament_color_id: "asa-black", label: "ASA · Black" }],
      };
      const mk4: PrinterMachine = {
        ...makePrinter(),
        id: "mk4",
        name: "MK4",
        loaded_filaments: [{ slot: 1, filament_color_id: "pla-red", label: "PLA · Red" }],
      };
      const copies = mergePartsToCopies([
        makePart(dir, "bracket.stl", 20, {
          filamentColorId: "asa-black",
          filamentDisplay: "ASA · Black",
        }),
        makePart(dir, "clip.stl", 20, {
          filamentColorId: "pla-red",
          filamentDisplay: "PLA · Red",
        }),
      ]);
      const { preview, plate_count } = packPreviewForPrinters(
        [voron, mk4],
        copies,
        {},
        4,
        "location",
      );

      expect(plate_count).toBeGreaterThan(0);
      const beds = preview as PreviewBed[];
      expect(beds.map((b) => b.printer_id).sort()).toEqual(["mk4", "voron"]);
      expect(beds.every((b) => b.plates.length > 0)).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

function mergePartsResult(parts: MergePartExport[] = []) {
  return {
    name: "kit",
    orderNumber: null,
    parts,
    completedByMatchKey: {},
  };
}

function memoryRepo(): AppRepository {
  const settings = new Map<string, string>();
  return {
    getSetting: (k: string) => settings.get(k) ?? null,
    setSetting: (k: string, v: string) => {
      settings.set(k, v);
    },
    buildMergePartsForProfile: () => mergePartsResult(),
  } as unknown as AppRepository;
}

function printerWithFilament(
  id: string,
  name: string,
  filamentId: string,
  label: string,
): PrinterMachine {
  return {
    id,
    name,
    model: name,
    bed_width_mm: 200,
    bed_depth_mm: 200,
    bed_height_mm: 200,
    margin_mm: 4,
    max_filament_slots: 1,
    loaded_filaments: [{ slot: 1, filament_color_id: filamentId, label }],
  };
}

describe("buildPlateWorkspace enabled printer subset", () => {
  it("suggests and warns against enabled printers only", () => {
    const dir = mkdtempSync(join(tmpdir(), "pp-ws-enabled-"));
    try {
      const voron = printerWithFilament("voron", "Voron 350", "asa-black", "ASA · Black");
      const mk4 = printerWithFilament("mk4", "MK4", "pla-red", "PLA · Red");
      const parts = [
        makePart(dir, "bracket.stl", 20, {
          filamentColorId: "asa-black",
          filamentDisplay: "ASA · Black",
        }),
      ];
      const repo = memoryRepo();
      saveFleet(repo, [voron, mk4]);
      saveKitPrintPlan(repo, 1, {
        enabled_printer_ids: ["mk4"],
        group_assignments: {},
        grouping_strategy: "location",
        plate_layout: null,
      });
      repo.buildMergePartsForProfile = () => mergePartsResult(parts);

      const workspace = buildPlateWorkspace(repo, 1);
      expect(workspace.groups).toHaveLength(1);
      expect(workspace.groups[0].suggested_printer_id).toBe("mk4");
      expect(workspace.groups[0].warning).toMatch(/ASA · Black/);
      expect(workspace.groups[0].suggested_printer_id).not.toBe("voron");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
