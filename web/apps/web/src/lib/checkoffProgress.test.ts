import { describe, expect, it } from "vitest";
import {
  applyStackToggle,
  formatCheckoffSummary,
  printedCountFromUnits,
} from "./checkoffProgress";

describe("applyStackToggle", () => {
  it("marks prefix through unit index when completing", () => {
    expect(applyStackToggle([false, false], 1, true)).toEqual([true, true]);
  });

  it("clears from unit index when uncompleting", () => {
    expect(applyStackToggle([true, true], 1, false)).toEqual([true, false]);
    expect(applyStackToggle([true, false], 0, false)).toEqual([false, false]);
  });
});

describe("printedCountFromUnits", () => {
  it("counts completed slots", () => {
    expect(printedCountFromUnits([true, false, true])).toBe(2);
  });
});

describe("formatCheckoffSummary", () => {
  it("sums only visible parts", () => {
    const text = formatCheckoffSummary([
      { quantity_effective: 1, printed_count: 1, missing: false },
      { quantity_effective: 2, printed_count: 1, missing: true },
    ]);
    expect(text).toBe("1/2 parts fully printed · 2/3 units");
  });

  it("handles empty list", () => {
    expect(formatCheckoffSummary([])).toBe(
      "0/0 parts fully printed · 0/0 units",
    );
  });
});
