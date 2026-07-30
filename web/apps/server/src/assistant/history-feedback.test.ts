import { describe, expect, it } from "vitest";
import {
  aggregateFeedbackScores,
  appendAssistantFeedback,
  loadAssistantFeedback,
  scorePlanFeedback,
  scoreStackPreset,
} from "./history.js";
import type { AppRepository } from "../db/repository.js";

function memoryRepo(): AppRepository & { _store: Map<string, string> } {
  const store = new Map<string, string>();
  return {
    _store: store,
    getSetting: (key: string) => store.get(key) ?? null,
    setSetting: (key: string, value: string) => {
      store.set(key, value);
    },
  } as unknown as AppRepository & { _store: Map<string, string> };
}

describe("aggregateFeedbackScores", () => {
  it("scores plans and known stack tokens without dumping raw feedback", () => {
    const repo = memoryRepo();
    appendAssistantFeedback(repo, {
      rating: "up",
      plan_id: 7,
      message_excerpt: "Applied voron_2.4_stock_sb_tap successfully",
    });
    appendAssistantFeedback(repo, {
      rating: "up",
      plan_id: 7,
      message_excerpt: "Still good",
    });
    appendAssistantFeedback(repo, {
      rating: "down",
      plan_id: 3,
      message_excerpt: "Bad suggestion for voron_2.4_stock_sb_tap",
    });

    const scores = aggregateFeedbackScores(repo, ["voron_2.4_stock_sb_tap", "ldo_2.4_sb_tap"]);
    expect(scores.byPlanId.get(7)).toBe(2);
    expect(scores.byPlanId.get(3)).toBe(-1);
    expect(scores.byToken.get("voron_2.4_stock_sb_tap")).toBe(0); // +1 and -1
    expect(scorePlanFeedback(repo, 7)).toBe(2);
    expect(scoreStackPreset(repo, "ldo_2.4_sb_tap", ["ldo_2.4_sb_tap"])).toBe(0);
    expect(loadAssistantFeedback(repo)).toHaveLength(3);
  });
});
