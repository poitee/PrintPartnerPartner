import { describe, expect, it } from "vitest";
import { pageDensityFromPath } from "./pageDensity";

describe("pageDensityFromPath", () => {
  it("uses a denser layout for Production and Printers", () => {
    expect(pageDensityFromPath("/production")).toBe("dense");
    expect(pageDensityFromPath("/export")).toBe("dense");
    expect(pageDensityFromPath("/printers")).toBe("dense");
    expect(pageDensityFromPath("/export/")).toBe("dense");
  });

  it("keeps Sources, Plan, Checkoff, Builds, and Settings calm", () => {
    expect(pageDensityFromPath("/builds")).toBe("calm");
    expect(pageDensityFromPath("/sources")).toBe("calm");
    expect(pageDensityFromPath("/plan")).toBe("calm");
    expect(pageDensityFromPath("/progress")).toBe("calm");
    expect(pageDensityFromPath("/settings")).toBe("calm");
    expect(pageDensityFromPath("/library")).toBe("calm");
    expect(pageDensityFromPath("/dev/catalog")).toBe("calm");
  });
});
