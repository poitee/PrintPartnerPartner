import { describe, expect, it } from "vitest";
import {
  appendAssistantHistory,
  appendPendingProposedActions,
  clearAssistantHistory,
  loadAssistantHistory,
  removePendingProposedAction,
} from "./history.js";
import { buildSyncThenUpdateAction } from "./sync-then-update.js";
import type { AppRepository } from "../db/repository.js";
import type { AssistantProposedAction } from "@print-partner/contracts";

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

describe("pending proposed actions in history", () => {
  it("persists Apply cards with assistant turns and strips ui_*", () => {
    const repo = memoryRepo();
    const mutate: AssistantProposedAction = {
      id: "a1",
      type: "set_base",
      plan_id: 1,
      label: "Set base",
      summary: "Set base Voron",
      params: { source_name: "Voron-Trident" },
    };
    const ui: AssistantProposedAction = {
      id: "u1",
      type: "ui_navigate",
      plan_id: 1,
      label: "Open build",
      summary: "nav",
      params: { route: "build" },
    };
    appendAssistantHistory(repo, [
      { role: "user", content: "Set Trident" },
      { role: "assistant", content: "Confirm below", proposed_actions: [mutate, ui] },
    ]);
    const hist = loadAssistantHistory(repo);
    const assistant = hist.find((m) => m.role === "assistant");
    expect(assistant?.proposed_actions?.map((a) => a.type)).toEqual(["set_base"]);
  });

  it("removes pending actions on apply/dismiss and appends follow-ups", () => {
    const repo = memoryRepo();
    appendAssistantHistory(repo, [
      { role: "user", content: "hi" },
      {
        role: "assistant",
        content: "ok",
        proposed_actions: [
          {
            id: "a1",
            type: "set_base",
            plan_id: 2,
            label: "Set base",
            summary: "x",
            params: {},
          },
        ],
      },
    ]);
    expect(removePendingProposedAction(repo, "a1")).toBe(true);
    expect(loadAssistantHistory(repo).at(-1)?.proposed_actions).toBeUndefined();

    const follow = buildSyncThenUpdateAction({
      planId: 2,
      projectIds: [9],
      sourceName: "Voron-Trident",
    });
    expect(appendPendingProposedActions(repo, [follow])).toBe(true);
    const pending = loadAssistantHistory(repo).at(-1)?.proposed_actions ?? [];
    expect(pending).toHaveLength(1);
    expect(pending[0]!.label).toBe("Sync → Update build");
    expect(pending[0]!.params.workflow).toBe("sync_then_recompute");
    expect((pending[0]!.params.steps as unknown[]).length).toBe(2);

    clearAssistantHistory(repo);
    expect(loadAssistantHistory(repo)).toHaveLength(0);
  });
});

describe("buildSyncThenUpdateAction", () => {
  it("builds apply_build_recipe with sync then recompute", () => {
    const action = buildSyncThenUpdateAction({ planId: 5, sourceName: "Voron-2" });
    expect(action.type).toBe("apply_build_recipe");
    const steps = action.params.steps as Array<{ type: string }>;
    expect(steps.map((s) => s.type)).toEqual(["start_sync", "start_recompute"]);
  });
});
