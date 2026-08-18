import { describe, expect, it } from "vitest";
import type { PartCopy } from "./checkoff-missing.js";
import { buildPrintGroupRows, makeGroupKey } from "./print-plan-grouping.js";
import type { MergePartExport, PrinterMachine } from "./filament-assigner.js";

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
    max_filament_slots: 1,
    loaded_filaments: loaded.map((lf) => ({
      slot: lf.slot,
      filament_color_id: lf.filament_color_id,
      label: lf.label ?? "",
    })),
  };
}

function copy(filename: string, extras: Partial<MergePartExport> = {}): PartCopy {
  const part: MergePartExport = {
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
  return { part, unit: 1 };
}

describe("buildPrintGroupRows", () => {
  it("lists part names and suggests the matching printer", () => {
    const voron = printer("voron", "Voron 350", [
      { slot: 1, filament_color_id: "asa-black", label: "ASA · Black" },
    ]);
    const rows = buildPrintGroupRows(
      [copy("bracket.stl", { filamentColorId: "asa-black", filamentDisplay: "ASA · Black" })],
      [voron],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].parts).toEqual(["bracket.stl"]);
    expect(rows[0].suggested_printer_id).toBe("voron");
    expect(rows[0].warning).toBeNull();
  });

  it("warns when no enabled printer has the filament", () => {
    const mk4 = printer("mk4", "MK4", [{ slot: 1, filament_color_id: "pla-red", label: "PLA · Red" }]);
    const rows = buildPrintGroupRows(
      [copy("panel.stl", { filamentColorId: "asa-black", filamentDisplay: "ASA · Black" })],
      [mk4],
    );
    expect(rows[0].warning).toBe("Assign ASA · Black to MK4 or enable another printer.");
  });

  it("ignores a saved assignment to a printer not in the enabled set", () => {
    const mk4 = printer("mk4", "MK4", [{ slot: 1, filament_color_id: "pla-red", label: "PLA · Red" }]);
    const copies = [copy("panel.stl", { filamentColorId: "asa-black", filamentDisplay: "ASA · Black" })];
    const groupKey = makeGroupKey("asa-black", "repo", "(root)");
    const kept = buildPrintGroupRows(copies, [mk4], { [groupKey]: "mk4" });
    expect(kept[0].printer_id).toBe("mk4");
    const dropped = buildPrintGroupRows(copies, [mk4], { [groupKey]: "voron" });
    expect(dropped[0].printer_id).toBeNull();
    expect(dropped[0].suggested_printer_id).toBe("mk4");
  });

  it("does not warn for display-only parts that match a slot label", () => {
    const voron = printer("voron", "Voron 350", [
      { slot: 1, filament_color_id: "asa-black", label: "ASA · Black" },
    ]);
    const rows = buildPrintGroupRows(
      [copy("panel.stl", { filamentDisplay: "ASA · Black" })],
      [voron],
    );
    expect(rows[0].warning).toBeNull();
    expect(rows[0].suggested_printer_id).toBe("voron");
  });
});
