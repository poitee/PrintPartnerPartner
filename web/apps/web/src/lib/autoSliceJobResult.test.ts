import { describe, expect, it } from "vitest";
import type { AutoSlicePlate } from "../api/engine";
import { describeFailures, describeRouting, slicerLabel, stderrTail } from "./autoSliceJobResult";

function plate(overrides: Partial<AutoSlicePlate> = {}): AutoSlicePlate {
  return {
    printer_id: "p1",
    printer_name: "Voron 350",
    plate_index: 1,
    slicer: "orca",
    status: "ok",
    gcode_path: "/exports/plan/gcode/plate_01.gcode",
    thumbnail_path: "/exports/plan/gcode/thumbnails/plate_01.png",
    error: null,
    error_code: null,
    stderr: null,
    exit_code: null,
    settings_keys: ["machine", "process", "filament"],
    download_url: "/exports/plan/gcode/plate_01.gcode",
    thumbnail_url: "/exports/plan/gcode/thumbnails/plate_01.png",
    ...overrides,
  };
}

describe("slicerLabel", () => {
  it("maps slicer ids to product names and passes unknowns through", () => {
    expect(slicerLabel("orca")).toBe("OrcaSlicer");
    expect(slicerLabel("prusa")).toBe("PrusaSlicer");
    expect(slicerLabel("bambu")).toBe("BambuStudio");
    expect(slicerLabel("cura")).toBe("cura");
  });
});

describe("describeRouting", () => {
  it("counts plates per slicer", () => {
    expect(
      describeRouting([plate(), plate({ plate_index: 2 }), plate({ plate_index: 3, slicer: "prusa" })]),
    ).toBe("2 on OrcaSlicer, 1 on PrusaSlicer");
  });
});

describe("stderrTail", () => {
  it("returns the last non-blank lines", () => {
    expect(stderrTail("a\n\nb\nc\n\n")).toBe("a\nb\nc");
    expect(stderrTail("l1\nl2\nl3\nl4", 2)).toBe("l3\nl4");
  });

  it("returns null for missing or blank stderr", () => {
    expect(stderrTail(null)).toBeNull();
    expect(stderrTail(undefined)).toBeNull();
    expect(stderrTail("   \n\n  ")).toBeNull();
  });
});

describe("describeFailures", () => {
  it("appends the slicer CLI stderr so the real cause is visible", () => {
    const text = describeFailures([
      plate({
        status: "error",
        error: "orca-slicer exited with code 1.",
        error_code: "slicer_execution_failed",
        exit_code: 1,
        stderr: '[info] loading\nError: unknown config option "wall_loops"\nSlicing aborted.',
        gcode_path: null,
        thumbnail_path: null,
        download_url: null,
        thumbnail_url: null,
      }),
    ]);

    expect(text).toContain("Plate 1 (Voron 350, OrcaSlicer): orca-slicer exited with code 1.");
    // Without this the user only ever sees "exited with code 1".
    expect(text).toContain('unknown config option "wall_loops"');
    expect(text).toContain("Slicing aborted.");
  });

  it("omits the stderr block when the failure carries none", () => {
    const text = describeFailures([
      plate({
        status: "error",
        error: "No slicer_sidecar integration configured.",
        error_code: "no_sidecar",
        gcode_path: null,
        download_url: null,
      }),
    ]);
    expect(text).toBe("Plate 1 (Voron 350, OrcaSlicer): No slicer_sidecar integration configured.");
  });

  it("truncates to the limit and says how many more failed", () => {
    const failures = [1, 2, 3, 4, 5].map((i) =>
      plate({ plate_index: i, status: "error", error: `boom ${i}`, gcode_path: null }),
    );
    const text = describeFailures(failures, 2);
    expect(text).toContain("boom 1");
    expect(text).toContain("boom 2");
    expect(text).not.toContain("boom 3");
    expect(text).toContain("…and 3 more");
  });
});
