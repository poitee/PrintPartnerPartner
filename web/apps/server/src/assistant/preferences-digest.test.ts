import { describe, expect, it } from "vitest";
import {
  buildPreferencesDigest,
  decisionFingerprint,
  isDismissedFingerprint,
} from "./preferences-digest.js";
import type { PlanDecision } from "@print-partner/contracts";
import type { AppRepository } from "../db/repository.js";

function decision(
  partial: Partial<PlanDecision> & Pick<PlanDecision, "kind" | "action_type" | "params">,
): PlanDecision {
  return {
    id: partial.id ?? 1,
    plan_id: partial.plan_id ?? 10,
    created_at: partial.created_at ?? "2026-01-01T00:00:00.000Z",
    actor: partial.actor ?? "user",
    kind: partial.kind,
    action_type: partial.action_type,
    params: partial.params,
    label: partial.label ?? "",
    summary: partial.summary ?? "",
    rationale: partial.rationale ?? null,
    result: partial.result ?? null,
  };
}

describe("decisionFingerprint", () => {
  it("canonicalizes action_type + key params", () => {
    expect(
      decisionFingerprint("set_base", { source_name: "Voron-Trident", tag: "VTr2", noise: 1 }),
    ).toBe("set_base|source_name=Voron-Trident;tag=VTr2");
  });
});

describe("buildPreferencesDigest", () => {
  it("prefers repeated applied patterns and lists dismissed fingerprints", () => {
    const decisions = [
      decision({
        kind: "applied_action",
        action_type: "set_base",
        params: { source_name: "Voron-Trident", tag: "VTr2" },
      }),
      decision({
        id: 2,
        kind: "applied_action",
        action_type: "set_base",
        params: { source_name: "Voron-Trident", tag: "VTr2" },
      }),
      decision({
        id: 3,
        kind: "applied_action",
        action_type: "add_addon",
        params: { source_name: "Voron-Stealthburner" },
      }),
      decision({
        id: 4,
        kind: "dismissed_action",
        action_type: "add_addon",
        params: { source_name: "Wrong-Addon" },
      }),
    ];

    const digest = buildPreferencesDigest(
      { listPlanDecisions: () => decisions } as unknown as AppRepository,
      10,
      decisions,
    );
    expect(digest).toContain("## User preferences (from this plan)");
    expect(digest).toContain("Prefer (2×): set_base source_name=Voron-Trident tag=VTr2");
    expect(digest).toContain("Prefer (1×): add_addon source_name=Voron-Stealthburner");
    expect(digest).toContain("Avoid re-proposing: add_addon source_name=Wrong-Addon");
  });

  it("returns null when there are no applied/dismissed decisions", () => {
    const decisions = [
      decision({ kind: "user_note", action_type: null, params: {}, summary: "note" }),
    ];
    expect(buildPreferencesDigest({} as AppRepository, 1, decisions)).toBeNull();
  });
});

describe("isDismissedFingerprint", () => {
  it("matches dismissed action fingerprints", () => {
    const decisions = [
      decision({
        kind: "dismissed_action",
        action_type: "apply_stack_preset",
        params: { preset_id: "voron_2.4_stock_sb_tap" },
      }),
    ];
    const repo = {
      listPlanDecisions: () => decisions,
    } as unknown as AppRepository;
    expect(
      isDismissedFingerprint(repo, 10, "apply_stack_preset", {
        preset_id: "voron_2.4_stock_sb_tap",
      }),
    ).toBe(true);
    expect(
      isDismissedFingerprint(repo, 10, "apply_stack_preset", {
        preset_id: "other",
      }),
    ).toBe(false);
  });
});
