import { describe, expect, it } from "vitest";
import type { PartCopy } from "./checkoff-missing.js";
import {
  assignPartsToPrinters,
  resolveEnabledPrinters,
  type MergePartExport,
  type PrinterMachine,
} from "./filament-assigner.js";

function printer(
  id: string,
  name: string,
  loaded: Array<{ slot: number; filament_color_id: string | null; label?: string }>,
): PrinterMachine {
  return {
    id,
    name,
    bed_width_mm: 250,
    bed_depth_mm: 210,
    bed_height_mm: 200,
    margin_mm: 4,
    max_filament_slots: Math.max(1, loaded.length),
    loaded_filaments: loaded.map((lf) => ({
      slot: lf.slot,
      filament_color_id: lf.filament_color_id,
      label: lf.label ?? "",
    })),
  };
}

function part(filename: string, extras: Partial<MergePartExport> = {}): MergePartExport {
  return {
    matchKey: filename,
    relativePath: filename,
    filename,
    sourceLayer: "base:repo",
    status: "included",
    role: extras.role ?? "primary",
    quantityAuto: 1,
    partSlug: filename.replace(/\.stl$/i, ""),
    included: true,
    quantityOverride: null,
    notes: "",
    geometrySame: null,
    absolutePath: `/tmp/${filename}`,
    ...extras,
  };
}

function copy(filename: string, extras: Partial<MergePartExport> = {}, unit = 1): PartCopy {
  return { part: part(filename, extras), unit };
}

describe("resolveEnabledPrinters", () => {
  const fleet = [printer("voron", "Voron 350", []), printer("mk4", "MK4", [])];

  it("uses the whole fleet when enabled ids are empty or missing", () => {
    expect(resolveEnabledPrinters(fleet, []).map((p) => p.id)).toEqual(["voron", "mk4"]);
    expect(resolveEnabledPrinters(fleet, null).map((p) => p.id)).toEqual(["voron", "mk4"]);
    expect(resolveEnabledPrinters(fleet, undefined).map((p) => p.id)).toEqual(["voron", "mk4"]);
  });

  it("returns the matching subset", () => {
    expect(resolveEnabledPrinters(fleet, ["mk4"]).map((p) => p.id)).toEqual(["mk4"]);
  });

  it("falls back to the fleet when no ids match", () => {
    expect(resolveEnabledPrinters(fleet, ["missing"]).map((p) => p.id)).toEqual(["voron", "mk4"]);
  });
});

describe("assignPartsToPrinters", () => {
  it("splits two filaments onto two printers", () => {
    const voron = printer("voron", "Voron 350", [
      { slot: 1, filament_color_id: "asa-black", label: "ASA · Black" },
    ]);
    const mk4 = printer("mk4", "MK4", [
      { slot: 1, filament_color_id: "pla-red", label: "PLA · Red" },
    ]);
    const copies = [
      copy("bracket.stl", { filamentColorId: "asa-black", filamentDisplay: "ASA · Black" }),
      copy("clip.stl", { filamentColorId: "pla-red", filamentDisplay: "PLA · Red" }),
    ];
    const [byPrinter, warnings] = assignPartsToPrinters(copies, [voron, mk4]);
    expect(warnings).toEqual([]);
    expect(byPrinter.voron.map((c) => c.part.filename)).toEqual(["bracket.stl"]);
    expect(byPrinter.mk4.map((c) => c.part.filename)).toEqual(["clip.stl"]);
  });

  it("warns and assigns to the first printer when no machine has the filament", () => {
    const voron = printer("voron", "Voron 350", [
      { slot: 1, filament_color_id: "pla-red", label: "PLA · Red" },
    ]);
    const copies = [
      copy("panel.stl", { filamentColorId: "asa-black", filamentDisplay: "ASA · Black" }),
    ];
    const [byPrinter, warnings] = assignPartsToPrinters(copies, [voron]);
    expect(byPrinter.voron).toHaveLength(1);
    expect(warnings.some((w) => w.includes("ASA · Black") && w.includes("Voron 350"))).toBe(true);
  });

  it("warns for role-only parts with no filament id", () => {
    const mk4 = printer("mk4", "MK4", [{ slot: 1, filament_color_id: null }]);
    const copies = [copy("spacer.stl", { role: "hardware" })];
    const [byPrinter, warnings] = assignPartsToPrinters(copies, [mk4]);
    expect(byPrinter.mk4).toHaveLength(1);
    expect(warnings.some((w) => w.includes("No filament") && w.includes("hardware"))).toBe(true);
  });

  it("balances load when two printers share the same loaded filament", () => {
    const a = printer("a", "A", [{ slot: 1, filament_color_id: "asa-black" }]);
    const b = printer("b", "B", [{ slot: 1, filament_color_id: "asa-black" }]);
    const copies = [
      copy("one.stl", { filamentColorId: "asa-black" }),
      copy("two.stl", { filamentColorId: "asa-black" }),
      copy("three.stl", { filamentColorId: "asa-black" }),
    ];
    const [byPrinter, warnings] = assignPartsToPrinters(copies, [a, b]);
    expect(warnings).toEqual([]);
    expect(byPrinter.a.length + byPrinter.b.length).toBe(3);
    expect(Math.abs(byPrinter.a.length - byPrinter.b.length)).toBeLessThanOrEqual(1);
  });

  it("returns a warning when no printers are enabled", () => {
    const copies = [copy("bracket.stl", { filamentColorId: "asa-black" })];
    const [byPrinter, warnings] = assignPartsToPrinters(copies, []);
    expect(byPrinter).toEqual({});
    expect(warnings).toEqual(["No printers enabled for this kit."]);
  });
});
