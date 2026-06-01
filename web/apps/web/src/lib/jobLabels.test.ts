import { describe, expect, it } from "vitest";
import { jobKindLabel } from "./jobLabels";

describe("jobKindLabel", () => {
  it("maps known job kinds", () => {
    expect(jobKindLabel("recompute")).toBe("Recompute");
    expect(jobKindLabel("export-3mf")).toBe("Export 3MF");
  });

  it("falls back for unknown kinds", () => {
    expect(jobKindLabel("custom-job")).toBe("custom job");
  });
});
