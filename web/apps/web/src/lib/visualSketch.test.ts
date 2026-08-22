import { describe, expect, it } from "vitest";
import {
  ACCEPTED_VISUAL_SKETCH,
  visualSketchLabel,
  visualSketchSummary,
} from "./visualSketch";

describe("visual sketches", () => {
  it("names the three Phase 8 directions", () => {
    expect(visualSketchLabel("workshop")).toBe("Workshop ledger");
    expect(visualSketchLabel("console")).toBe("Production console");
    expect(visualSketchLabel("hybrid")).toBe("Build and production hybrid");
  });

  it("accepts the hybrid density model with the current token family", () => {
    expect(ACCEPTED_VISUAL_SKETCH).toBe("hybrid");
    expect(visualSketchSummary("hybrid")).toContain("calm planning");
  });
});
