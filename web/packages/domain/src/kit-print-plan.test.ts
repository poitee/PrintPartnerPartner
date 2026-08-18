import { describe, expect, it } from "vitest";
import {
  kitPrintPlanFromDict,
  kitPrintPlanToDict,
  type KitPrintPlan,
} from "./kit-print-plan.js";

describe("kit print-plan serialization", () => {
  it("round-trips a complete supported plate layout without coercing values", () => {
    const plan: KitPrintPlan = {
      enabled_printer_ids: ["voron", "mk4"],
      plate_layout: {
        spacing_mm: 6.5,
        printers: [
          {
            printer_id: "voron",
            plates: [
              [
                { match_key: "base/plate.stl", unit: 1 },
                { match_key: "base/plate.stl", unit: 2 },
              ],
              [{ match_key: "clips/clip.stl", unit: 1 }],
            ],
            unassigned: [{ match_key: "later/bracket.stl", unit: 3 }],
          },
        ],
        pool: [{ match_key: "unclassified/panel.stl", unit: 1 }],
      },
      group_assignments: {
        "asa-black\u0000repo\u0000base": "voron",
        "pla-red\u0000repo\u0000clips": "mk4",
      },
      grouping_strategy: "height_band",
    };

    expect(kitPrintPlanFromDict(kitPrintPlanToDict(plan))).toEqual(plan);
  });

  it("supplies legacy defaults only when optional fields are absent", () => {
    expect(kitPrintPlanFromDict({})).toEqual({
      enabled_printer_ids: [],
      plate_layout: null,
      group_assignments: {},
      grouping_strategy: "location",
    });
  });

  it.each([
    [{ enabled_printer_ids: "voron" }, "enabled_printer_ids"],
    [{ enabled_printer_ids: ["voron", 7] }, "enabled_printer_ids"],
    [{ group_assignments: [] }, "group_assignments"],
    [{ group_assignments: { group: 7 } }, "group_assignments"],
    [{ grouping_strategy: "random" }, "grouping_strategy"],
    [{ plate_layout: [] }, "plate_layout"],
    [
      { plate_layout: { spacing_mm: "4", printers: [], pool: [] } },
      "plate_layout.spacing_mm",
    ],
    [
      {
        plate_layout: {
          spacing_mm: 4,
          printers: [{ printer_id: "", plates: [], unassigned: [] }],
          pool: [],
        },
      },
      "plate_layout.printers[0].printer_id",
    ],
    [
      {
        plate_layout: {
          spacing_mm: 4,
          printers: [],
          pool: [{ match_key: "part.stl", unit: 0 }],
        },
      },
      "plate_layout.pool[0].unit",
    ],
  ])("rejects malformed persisted data at %s", (data, field) => {
    expect(() => kitPrintPlanFromDict(data as Record<string, unknown>)).toThrow(
      `Invalid kit print plan: ${field}`,
    );
  });
});
