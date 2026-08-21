import { describe, expect, it } from "vitest";
import { formatPlateEstimates } from "./KitPrinterSelectPanel";
import type { PrinterBedPreview, PrinterMachine } from "../../api/engine";

function printer(id: string, name: string): PrinterMachine {
  return {
    id,
    name,
    model: name,
    bed_width_mm: 250,
    bed_depth_mm: 210,
    bed_height_mm: 200,
    margin_mm: 4,
    max_filament_slots: 1,
    loaded_filaments: [],
  };
}

function preview(id: string, plates: number): PrinterBedPreview {
  return {
    printer_id: id,
    bed_width_mm: 250,
    bed_depth_mm: 210,
    margin_mm: 4,
    plates: Array.from({ length: plates }, (_, i) => ({
      index: i + 1,
      group_label: "",
      items: [],
    })),
  };
}

describe("formatPlateEstimates", () => {
  it("lists enabled printers with plate counts", () => {
    const line = formatPlateEstimates(
      [printer("voron", "Voron 350"), printer("mk4", "MK4")],
      [preview("voron", 2), preview("mk4", 1)],
      ["voron", "mk4"],
    );
    expect(line).toBe("Voron 350: ~2 plates · MK4: ~1 plate");
  });
});
