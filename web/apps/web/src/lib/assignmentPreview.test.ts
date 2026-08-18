import { describe, expect, it } from "vitest";
import { groupAssignmentsByPrinter } from "./assignmentPreview";
import type { PrintGroup, PrinterMachine } from "../api/engine";

function printer(id: string, name: string): PrinterMachine {
  return {
    id,
    name,
    bed_width_mm: 250,
    bed_depth_mm: 210,
    bed_height_mm: 200,
    margin_mm: 4,
    max_filament_slots: 1,
    loaded_filaments: [],
  };
}

function group(partial: Partial<PrintGroup> & Pick<PrintGroup, "group_key" | "label">): PrintGroup {
  return {
    filament_key: "k",
    filament_label: "ASA · Black",
    filament_hex: null,
    repo: "repo",
    folder: "(root)",
    part_count: 1,
    parts: ["bracket.stl"],
    printer_id: null,
    suggested_printer_id: null,
    suggested_printer_name: null,
    warning: null,
    ...partial,
  };
}

describe("groupAssignmentsByPrinter", () => {
  it("nests groups under the suggested printer", () => {
    const buckets = groupAssignmentsByPrinter(
      [group({ group_key: "a", label: "ASA · Black · repo", suggested_printer_id: "voron" })],
      [printer("voron", "Voron 350"), printer("mk4", "MK4")],
      {},
    );
    expect(buckets.map((b) => b.printerName)).toEqual(["Voron 350"]);
    expect(buckets[0].groups).toHaveLength(1);
  });

  it("honors a manual assignment over the suggestion", () => {
    const buckets = groupAssignmentsByPrinter(
      [group({ group_key: "a", label: "ASA · Black · repo", suggested_printer_id: "voron" })],
      [printer("voron", "Voron 350"), printer("mk4", "MK4")],
      { a: "mk4" },
    );
    expect(buckets.map((b) => b.printerName)).toEqual(["MK4"]);
  });
});
