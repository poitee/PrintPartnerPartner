import { describe, expect, it, vi } from "vitest";
import type { AppRepository } from "../db/repository.js";
import { loadKitPrintPlan } from "./print-plan-store.js";

const loadWithWarnings = loadKitPrintPlan as unknown as (
  repo: AppRepository,
  profileId: number,
  warning: (message: string, error?: unknown) => void,
) => ReturnType<typeof loadKitPrintPlan>;

describe("loadKitPrintPlan", () => {
  it("preserves valid persisted fields while logging and defaulting malformed fields", () => {
    const warning = vi.fn();
    const repo = {
      getSetting: () =>
        JSON.stringify({
          enabled_printer_ids: ["voron"],
          plate_layout: null,
          group_assignments: { valid: "voron", invalid: 7 },
          grouping_strategy: "height_band",
        }),
    } as unknown as AppRepository;

    const plan = loadWithWarnings(repo, 7, warning);

    expect(plan).toEqual({
      enabled_printer_ids: ["voron"],
      plate_layout: null,
      group_assignments: {},
      grouping_strategy: "height_band",
    });
    expect(warning).toHaveBeenCalledOnce();
    expect(warning.mock.calls[0]?.[0]).toContain("group_assignments");
  });

  it("logs invalid JSON and returns the complete default plan", () => {
    const warning = vi.fn();
    const repo = {
      getSetting: () => "{not-json",
    } as unknown as AppRepository;

    expect(loadWithWarnings(repo, 7, warning)).toEqual({
      enabled_printer_ids: [],
      plate_layout: null,
      group_assignments: {},
      grouping_strategy: "location",
    });
    expect(warning).toHaveBeenCalledOnce();
  });
});
