/** Catalog-only visual directions from the Phase 8 UI discussion. */

export const VISUAL_SKETCHES = ["workshop", "console", "hybrid"] as const;

export type VisualSketch = (typeof VISUAL_SKETCHES)[number];

export function visualSketchLabel(sketch: VisualSketch): string {
  switch (sketch) {
    case "workshop":
      return "Workshop ledger";
    case "console":
      return "Production console";
    case "hybrid":
      return "Build and production hybrid";
  }
}

export function visualSketchSummary(sketch: VisualSketch): string {
  switch (sketch) {
    case "workshop":
      return "Warm ink, paper, and brass. Planning stays primary.";
    case "console":
      return "Cool technical surfaces. Live jobs take more space.";
    case "hybrid":
      return "Current tokens with calm planning and denser Production.";
  }
}

/** Shipping visual direction after catalog comparison. */
export const ACCEPTED_VISUAL_SKETCH: VisualSketch = "hybrid";
