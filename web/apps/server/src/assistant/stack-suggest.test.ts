import { describe, expect, it } from "vitest";
import { suggestSoftStackActions } from "./stack-suggest.js";
import type { AppRepository } from "../db/repository.js";
import type { PlanDecision } from "@print-partner/contracts";

const catalog = {
  bases: {
    voron_2_4: {
      source_name: "Voron-2",
      default_addons: ["Voron-Stealthburner", "Voron-Tap"],
    },
  },
  stack_presets: {
    v24_sb_tap: {
      label: "2.4 SB Tap",
      base: "voron_2_4",
      addon_sources: ["Voron-Stealthburner", "Voron-Tap"],
    },
  },
};

function mockRepo(opts: {
  layers: Array<{ layer_type: string; project_name: string | null }>;
  decisions?: PlanDecision[];
}): AppRepository {
  return {
    getProfile: () => ({ id: 1, name: "P" }),
    getProfileLayers: () =>
      opts.layers.map((l, i) => ({
        id: i + 1,
        layer_type: l.layer_type,
        project_name: l.project_name,
        project_id: i + 1,
        layer_order: i,
      })),
    listPlanDecisions: () => opts.decisions ?? [],
    getSetting: () => null,
    setSetting: () => undefined,
  } as unknown as AppRepository;
}

describe("suggestSoftStackActions", () => {
  it("proposes apply_stack_preset when base is set and addons are missing", () => {
    const actions = suggestSoftStackActions({
      repo: mockRepo({
        layers: [{ layer_type: "base", project_name: "Voron-2" }],
      }),
      planId: 1,
      catalog,
    });
    expect(actions).toHaveLength(1);
    expect(actions[0]!.type).toBe("apply_stack_preset");
    expect(actions[0]!.params.preset_id).toBe("v24_sb_tap");
  });

  it("skips when addons already present or action already proposed", () => {
    expect(
      suggestSoftStackActions({
        repo: mockRepo({
          layers: [
            { layer_type: "base", project_name: "Voron-2" },
            { layer_type: "addon", project_name: "Voron-Tap" },
          ],
        }),
        planId: 1,
        catalog,
      }),
    ).toEqual([]);

    expect(
      suggestSoftStackActions({
        repo: mockRepo({
          layers: [{ layer_type: "base", project_name: "Voron-2" }],
        }),
        planId: 1,
        catalog,
        existingActions: [
          {
            id: "x",
            type: "add_addon",
            plan_id: 1,
            label: "x",
            summary: "x",
            params: { source_name: "Voron-Tap" },
          },
        ],
      }),
    ).toEqual([]);
  });

  it("falls back to add_addon when no matching preset", () => {
    const actions = suggestSoftStackActions({
      repo: mockRepo({
        layers: [{ layer_type: "base", project_name: "Voron-2" }],
      }),
      planId: 1,
      catalog: {
        bases: {
          voron_2_4: {
            source_name: "Voron-2",
            default_addons: ["Voron-Stealthburner"],
          },
        },
        stack_presets: {},
      },
    });
    expect(actions.map((a) => a.type)).toEqual(["add_addon"]);
    expect(actions[0]!.params.source_name).toBe("Voron-Stealthburner");
  });
});
