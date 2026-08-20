import { describe, expect, it } from "vitest";
import { digestPlanDraft } from "./plan-drafts.js";

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
