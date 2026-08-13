import { describe, expect, it } from "vitest";
import {
  CHECKOFF_UI_STORAGE_KEY,
  getPartOrderForPlan,
  parsePersistedCheckoffUi,
  serializePersistedCheckoffUi,
  withPartOrderForPlan,
} from "./persistedCheckoffUi";

describe("persistedCheckoffUi", () => {
  it("returns defaults for empty input", () => {
    expect(parsePersistedCheckoffUi(null)).toEqual({
      filter: "missing",
      compactMode: false,
      continuousPrintLayout: false,
      partOrderByPlanId: {},
    });
  });

  it("round-trips filter and part order", () => {
    const state = {
      filter: "done" as const,
      compactMode: true,
      continuousPrintLayout: true,
      partOrderByPlanId: { "12": [3, 1, 2] },
    };
    expect(parsePersistedCheckoffUi(serializePersistedCheckoffUi(state))).toEqual(state);
  });

  it("ignores invalid filter and order entries", () => {
    const parsed = parsePersistedCheckoffUi(
      JSON.stringify({
        filter: "maybe",
        partOrderByPlanId: {
          "1": [1, "x", 2],
          bad: null,
        },
      }),
    );
    expect(parsed.filter).toBe("missing");
    expect(parsed.partOrderByPlanId).toEqual({ "1": [1, 2] });
  });

  it("get/withPartOrderForPlan helpers", () => {
    const base = parsePersistedCheckoffUi(null);
    expect(getPartOrderForPlan(base, 7)).toEqual([]);
    const next = withPartOrderForPlan(base, 7, [9, 8]);
    expect(getPartOrderForPlan(next, 7)).toEqual([9, 8]);
    expect(getPartOrderForPlan(next, null)).toEqual([]);
  });

  it("uses stable storage key", () => {
    expect(CHECKOFF_UI_STORAGE_KEY).toBe("print-partner.checkoff.ui.v1");
  });
});
