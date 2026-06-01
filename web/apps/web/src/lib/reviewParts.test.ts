import { describe, expect, it } from "vitest";
import type { PartRow, PlanReview } from "../api/engine";
import {
  filterPartsByQuery,
  mergePartIntoReview,
  partitionIncludedParts,
  sourceLabelFromLayer,
} from "./reviewParts";

const samplePart = (overrides: Partial<PartRow> & { id: number }): PartRow => ({
  match_key: "k",
  relative_path: "a.stl",
  filename: "a.stl",
  source_layer: "base:main-kit",
  status: "ok",
  role: "primary",
  requirement: null,
  option_group_id: null,
  included: true,
  filament_color_id: null,
  quantity_auto: 1,
  quantity_override: null,
  quantity_effective: 1,
  ...overrides,
});

describe("sourceLabelFromLayer", () => {
  it("extracts repo name after layer prefix", () => {
    expect(sourceLabelFromLayer("addon:extras")).toBe("extras");
    expect(sourceLabelFromLayer(null)).toBe("Other");
  });
});

describe("partitionIncludedParts", () => {
  it("splits and sorts by filename", () => {
    const { included, excluded } = partitionIncludedParts([
      samplePart({ id: 2, filename: "z.stl", included: false }),
      samplePart({ id: 1, filename: "a.stl", included: true }),
    ]);
    expect(included.map((p) => p.id)).toEqual([1]);
    expect(excluded.map((p) => p.id)).toEqual([2]);
  });
});

describe("filterPartsByQuery", () => {
  it("matches filename and source label", () => {
    const parts = [
      samplePart({ id: 1, filename: "bracket.stl" }),
      samplePart({ id: 2, filename: "wheel.stl", source_layer: "addon:wheels" }),
    ];
    expect(filterPartsByQuery(parts, "wheels").map((p) => p.id)).toEqual([2]);
    expect(filterPartsByQuery(parts, "bracket").map((p) => p.id)).toEqual([1]);
  });
});

describe("mergePartIntoReview", () => {
  it("updates totals when a part is excluded", () => {
    const review: PlanReview = {
      profile_id: 1,
      plan_name: "Test",
      layers: [],
      totals: {
        included_parts: 1,
        total_print_units: 2,
        by_role: { primary: 1 },
        by_filament: {},
      },
      issues: [],
      has_blockers: false,
      part_groups: [
        {
          folder: "(root)",
          source_layer: "base:main-kit",
          parts: [samplePart({ id: 1, quantity_effective: 2 })],
        },
      ],
    };
    const next = mergePartIntoReview(
      review,
      samplePart({ id: 1, included: false, quantity_effective: 2 }),
    );
    expect(next.totals.included_parts).toBe(0);
    expect(next.totals.total_print_units).toBe(0);
  });
});
