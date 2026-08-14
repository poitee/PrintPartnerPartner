import { describe, expect, it } from "vitest";
import { spineUtilityNavItems } from "./spineUtilityNav";

describe("spineUtilityNavItems", () => {
  it("orders Plans · Printers · Settings · Help (not a sixth desk-loop step)", () => {
    expect(spineUtilityNavItems(7).map((item) => item.id)).toEqual([
      "plans",
      "printers",
      "settings",
      "help",
    ]);
    // Desk-loop stays Library → Plan → Parts → Progress → Export
    expect(spineUtilityNavItems(7).map((item) => item.path)).not.toContain("/library");
    expect(spineUtilityNavItems(7).map((item) => item.path)).not.toContain("/plan");
  });

  it("labels Plans (not All plans)", () => {
    const labels = spineUtilityNavItems(null).map((item) => item.label);
    expect(labels).toEqual(["Plans", "Printers", "Settings", "Help"]);
    expect(labels).not.toContain("All plans");
  });

  it("routes Plans through plansRoute with profile", () => {
    expect(spineUtilityNavItems(12)[0]).toMatchObject({
      id: "plans",
      to: "/plans?profile=12",
      path: "/plans",
      label: "Plans",
    });
  });
});
