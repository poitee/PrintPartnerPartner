import { describe, expect, it } from "vitest";
import {
  filterPlansList,
  planStatusLabel,
  PLANS_LIST_LIMIT,
  type PlansListRow,
} from "./plansList";

function row(
  partial: Partial<PlansListRow> & Pick<PlansListRow, "id" | "name">,
): PlansListRow {
  return {
    archived_at: null,
    part_count: 0,
    remaining_units: 0,
    total_units: 0,
    build_stale: false,
    ...partial,
  };
}

describe("filterPlansList", () => {
  it("filters Active / Archived / All and sorts by name", () => {
    const plans = [
      row({ id: 1, name: "Zebra", archived_at: null }),
      row({ id: 2, name: "Alpha", archived_at: "2026-08-01T00:00:00Z" }),
      row({ id: 3, name: "Beta", archived_at: null }),
    ];
    expect(filterPlansList(plans, "active").map((p) => p.name)).toEqual([
      "Beta",
      "Zebra",
    ]);
    expect(filterPlansList(plans, "archived").map((p) => p.name)).toEqual([
      "Alpha",
    ]);
    expect(filterPlansList(plans, "all").map((p) => p.name)).toEqual([
      "Alpha",
      "Beta",
      "Zebra",
    ]);
  });

  it("caps at PLANS_LIST_LIMIT", () => {
    const plans = Array.from({ length: PLANS_LIST_LIMIT + 5 }, (_, i) =>
      row({ id: i + 1, name: `Plan ${String(i).padStart(2, "0")}` }),
    );
    expect(filterPlansList(plans, "all")).toHaveLength(PLANS_LIST_LIMIT);
  });
});

describe("planStatusLabel", () => {
  it("labels archived vs active", () => {
    expect(planStatusLabel({ archived_at: null })).toBe("Active");
    expect(planStatusLabel({ archived_at: "2026-08-14T00:00:00Z" })).toBe(
      "Archived",
    );
  });
});
