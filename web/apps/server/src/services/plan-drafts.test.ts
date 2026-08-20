import { describe, expect, it } from "vitest";
import {
  applyPlanDraftPartDecision,
  digestPlanDraft,
  MAX_PLAN_DRAFT_PART_QUANTITY,
  type PlanDraftPartDecision,
  type PlanDraftSnapshot,
} from "./plan-drafts.js";

type DigestInput = Parameters<typeof digestPlanDraft>[0];

function fixture(): DigestInput {
  return {
    baseRevisionId: 11,
    basePlanVersion: 3,
    inputs: [
      {
        sourceId: 7,
        sourceLayer: "base:Frame",
        layerOrder: 1,
        trackingKind: "revision",
        sourceRevisionId: 17,
        manifestDigest: "a".repeat(64),
        effectiveNamingDigest: "b".repeat(64),
      },
    ],
    parts: [
      {
        baseRevisionPartId: 23,
        partKey: "parts/bracket.stl",
        relativePath: "parts/bracket.stl",
        filename: "bracket.stl",
        sourceLayer: "base:Frame",
        status: "base",
        roleInferred: "primary",
        roleOverride: "accent",
        filamentColorId: "orange",
        filamentCustomHex: "#ff5500",
        spoolmanSpoolId: "42",
        quantityInferred: 2,
        quantityOverride: 3,
        quantityEffective: 3,
        included: true,
        notes: "customer copy",
        githubBlobUrl: "https://example.test/bracket.stl",
        geometrySame: true,
        requirement: "required",
        optionGroupId: "frame",
        manifestSource: "manifest.json",
        artifactDigest: "c".repeat(64),
      },
    ],
  };
}

function firstInput(value: DigestInput): DigestInput["inputs"][number] {
  const input = value.inputs[0];
  if (!input) throw new Error("digest fixture input is missing");
  return input;
}

function firstPart(value: DigestInput): DigestInput["parts"][number] {
  const part = value.parts[0];
  if (!part) throw new Error("digest fixture Part is missing");
  return part;
}

function draftFixture(): PlanDraftSnapshot {
  const input = fixture();
  const parts = [
    { ...firstPart(input), id: 31, draftId: 5 },
    {
      ...firstPart(input),
      id: 32,
      draftId: 5,
      baseRevisionPartId: 24,
      partKey: "parts/gear.stl",
      relativePath: "parts/gear.stl",
      filename: "gear.stl",
    },
  ];
  return {
    id: 5,
    profileId: 9,
    baseRevisionId: input.baseRevisionId,
    basePlanVersion: input.basePlanVersion,
    state: "open",
    digestFormat: "plan-draft-v1",
    snapshotDigest: digestPlanDraft({ ...input, parts }),
    createdBy: "test:user",
    idempotencyKey: "draft-5",
    createdAt: "2026-08-20T12:00:00.000Z",
    inputs: input.inputs.map((row, index) => ({ ...row, id: index + 1, draftId: 5 })),
    parts,
  };
}

describe("Plan draft digest", () => {
  it("covers every semantic base, input, Part, and predecessor field", () => {
    const mutations: Array<{
      label: string;
      mutate(value: DigestInput): void;
    }> = [
      { label: "base revision", mutate: (value) => { value.baseRevisionId = 12; } },
      { label: "base version", mutate: (value) => { value.basePlanVersion = 4; } },
      { label: "Source ID", mutate: (value) => { firstInput(value).sourceId = 8; } },
      { label: "Source layer", mutate: (value) => { firstInput(value).sourceLayer = "addon:Door"; } },
      { label: "layer order", mutate: (value) => { firstInput(value).layerOrder = 2; } },
      { label: "tracking kind", mutate: (value) => { firstInput(value).trackingKind = "untracked"; } },
      { label: "Source revision", mutate: (value) => { firstInput(value).sourceRevisionId = 18; } },
      { label: "manifest digest", mutate: (value) => { firstInput(value).manifestDigest = "d".repeat(64); } },
      { label: "naming digest", mutate: (value) => { firstInput(value).effectiveNamingDigest = "e".repeat(64); } },
      { label: "predecessor", mutate: (value) => { firstPart(value).baseRevisionPartId = 24; } },
      { label: "Part key", mutate: (value) => { firstPart(value).partKey = "parts/gear.stl"; } },
      { label: "relative path", mutate: (value) => { firstPart(value).relativePath = "parts/gear.stl"; } },
      { label: "filename", mutate: (value) => { firstPart(value).filename = "gear.stl"; } },
      { label: "Part Source", mutate: (value) => { firstPart(value).sourceLayer = "addon:Door"; } },
      { label: "status", mutate: (value) => { firstPart(value).status = "replaced"; } },
      { label: "inferred role", mutate: (value) => { firstPart(value).roleInferred = "clear"; } },
      { label: "role override", mutate: (value) => { firstPart(value).roleOverride = null; } },
      { label: "filament color", mutate: (value) => { firstPart(value).filamentColorId = "black"; } },
      { label: "filament hex", mutate: (value) => { firstPart(value).filamentCustomHex = "#000000"; } },
      { label: "Spoolman spool", mutate: (value) => { firstPart(value).spoolmanSpoolId = "43"; } },
      { label: "inferred quantity", mutate: (value) => { firstPart(value).quantityInferred = 4; } },
      { label: "quantity override", mutate: (value) => { firstPart(value).quantityOverride = null; } },
      { label: "effective quantity", mutate: (value) => { firstPart(value).quantityEffective = 4; } },
      { label: "inclusion", mutate: (value) => { firstPart(value).included = false; } },
      { label: "notes", mutate: (value) => { firstPart(value).notes = "changed"; } },
      { label: "GitHub URL", mutate: (value) => { firstPart(value).githubBlobUrl = null; } },
      { label: "geometry", mutate: (value) => { firstPart(value).geometrySame = false; } },
      { label: "requirement", mutate: (value) => { firstPart(value).requirement = "optional"; } },
      { label: "option group", mutate: (value) => { firstPart(value).optionGroupId = "skirts"; } },
      { label: "manifest source", mutate: (value) => { firstPart(value).manifestSource = null; } },
      { label: "artifact digest", mutate: (value) => { firstPart(value).artifactDigest = "f".repeat(64); } },
    ];
    const original = digestPlanDraft(fixture());

    for (const mutation of mutations) {
      const changed = structuredClone(fixture());
      mutation.mutate(changed);
      expect(digestPlanDraft(changed), mutation.label).not.toBe(original);
    }
  });
});

describe("Plan draft Part decisions", () => {
  it("applies grouped inclusion without mutating the complete input snapshot", () => {
    const draft = draftFixture();
    const before = structuredClone(draft);

    const next = applyPlanDraftPartDecision({
      draft,
      decision: { kind: "set_included", partIds: [32, 31], value: false },
    });

    expect(next.parts.map((part) => ({ id: part.id, included: part.included }))).toEqual([
      { id: 31, included: false },
      { id: 32, included: false },
    ]);
    expect(next.snapshotDigest).not.toBe(draft.snapshotDigest);
    expect(draft).toEqual(before);
  });

  it("sets and clears grouped quantity overrides and derives effective quantity", () => {
    const draft = draftFixture();
    const set = applyPlanDraftPartDecision({
      draft,
      decision: { kind: "set_quantity_override", partIds: [31, 32], value: 4 },
    });
    expect(
      set.parts.map((part) => ({
        id: part.id,
        quantityOverride: part.quantityOverride,
        quantityEffective: part.quantityEffective,
      })),
    ).toEqual([
      { id: 31, quantityOverride: 4, quantityEffective: 4 },
      { id: 32, quantityOverride: 4, quantityEffective: 4 },
    ]);

    const cleared = applyPlanDraftPartDecision({
      draft: set,
      decision: { kind: "set_quantity_override", partIds: [32, 31], value: null },
    });
    expect(
      cleared.parts.map((part) => ({
        id: part.id,
        quantityOverride: part.quantityOverride,
        quantityEffective: part.quantityEffective,
      })),
    ).toEqual([
      { id: 31, quantityOverride: null, quantityEffective: 2 },
      { id: 32, quantityOverride: null, quantityEffective: 2 },
    ]);
  });

  it("accepts the quantity ceiling and rejects unsafe or oversized values", () => {
    const draft = draftFixture();
    expect(MAX_PLAN_DRAFT_PART_QUANTITY).toBe(10_000);
    const capped = applyPlanDraftPartDecision({
      draft,
      decision: { kind: "set_quantity_override", partIds: [31], value: 10_000 },
    });
    expect(capped.parts[0]).toMatchObject({
      quantityOverride: 10_000,
      quantityEffective: 10_000,
    });

    for (const value of [10_001, Number.MAX_SAFE_INTEGER + 1, 1e100]) {
      expect(() =>
        applyPlanDraftPartDecision({
          draft,
          decision: { kind: "set_quantity_override", partIds: [31], value },
        }),
      ).toThrow();
    }
  });

  it("rejects invalid, duplicate, and missing Part IDs and invalid quantities", () => {
    const draft = draftFixture();
    const decisions: PlanDraftPartDecision[] = [
      { kind: "set_included", partIds: [], value: false },
      { kind: "set_included", partIds: [31, 31], value: false },
      { kind: "set_included", partIds: [0], value: false },
      { kind: "set_included", partIds: [31.5], value: false },
      { kind: "set_included", partIds: [99], value: false },
      { kind: "set_quantity_override", partIds: [31], value: 0 },
      { kind: "set_quantity_override", partIds: [31], value: 1.5 },
    ];

    for (const decision of decisions) {
      expect(() => applyPlanDraftPartDecision({ draft, decision })).toThrow();
    }
    const foreign = structuredClone(draft);
    const first = foreign.parts[0];
    if (!first) throw new Error("draft fixture Part is missing");
    first.draftId = 6;
    expect(() =>
      applyPlanDraftPartDecision({
        draft: foreign,
        decision: { kind: "set_included", partIds: [first.id], value: false },
      }),
    ).toThrow(/belong/i);
  });

  it("is deterministic across target order and returns an equal no-op snapshot", () => {
    const draft = draftFixture();
    const left = applyPlanDraftPartDecision({
      draft,
      decision: { kind: "set_included", partIds: [31, 32], value: false },
    });
    const right = applyPlanDraftPartDecision({
      draft,
      decision: { kind: "set_included", partIds: [32, 31], value: false },
    });
    expect(right).toEqual(left);

    const noOp = applyPlanDraftPartDecision({
      draft: left,
      decision: { kind: "set_included", partIds: [32, 31], value: false },
    });
    expect(noOp).toEqual(left);
  });
});
