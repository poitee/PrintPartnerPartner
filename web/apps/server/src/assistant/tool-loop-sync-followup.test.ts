import { describe, expect, it } from "vitest";
import { appendSyncThenUpdateIfNeeded } from "./tool-loop.js";
import type { ToolContext } from "./tools.js";
import type { AssistantProposedAction } from "@print-partner/contracts";

describe("appendSyncThenUpdateIfNeeded", () => {
  it("appends Sync → Update after tagged set_base", () => {
    const actions: AssistantProposedAction[] = [
      {
        id: "1",
        type: "set_base",
        plan_id: 6,
        label: "Set base",
        summary: "x",
        params: { source_name: "Voron-Trident", tag: "VTr2" },
      },
      {
        id: "2",
        type: "add_addon",
        plan_id: 6,
        label: "Add LDO",
        summary: "x",
        params: { source_name: "LDOVoronTrident" },
      },
    ];
    const repo = {
      listSources: () => [
        { id: 54, name: "Voron-Trident" },
        { id: 64, name: "LDOVoronTrident" },
      ],
    };
    appendSyncThenUpdateIfNeeded(
      { repo, activePlanId: 6 } as unknown as ToolContext,
      actions,
    );
    expect(actions.some((a) => a.params?.workflow === "sync_then_recompute")).toBe(
      true,
    );
  });

  it("appends Sync → Update after apply_stack_preset", () => {
    const actions: AssistantProposedAction[] = [
      {
        id: "1",
        type: "apply_stack_preset",
        plan_id: 6,
        label: "Apply stack",
        summary: "x",
        params: { preset_id: "ldo_trident_r2", base_tag: "VTr2" },
      },
    ];
    appendSyncThenUpdateIfNeeded(
      {
        repo: {
          listSources: () => [{ id: 54, name: "Voron-Trident" }],
        },
        activePlanId: 6,
      } as unknown as ToolContext,
      actions,
    );
    const sync = actions.find((a) => a.params?.workflow === "sync_then_recompute");
    expect(sync).toBeTruthy();
    expect(sync?.params?.source_name ?? sync?.summary).toBeTruthy();
  });
});
