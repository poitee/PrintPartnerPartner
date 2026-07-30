import { describe, expect, it } from "vitest";
import {
  buildAssistantSystemPrompt,
  summarizeKitCatalog,
} from "./assistant-context.js";

const sampleCatalog = {
  version: 1,
  bases: {
    voron_2_4: {
      label: "Voron 2.4",
      source_name: "Voron-2",
      compatible_addons: ["toolhead", "probe"],
    },
  },
  addon_categories: {
    toolhead: {
      rule: "pick_one",
      sources: [{ name: "Voron-Stealthburner" }],
    },
  },
  stack_presets: {
    v24_sb_tap: {
      label: "2.4 + SB + Tap",
      base: "voron_2_4",
      addon_sources: ["Voron-Stealthburner", "Voron-Tap"],
      default_selections: { probe: "tap" },
    },
  },
};

describe("summarizeKitCatalog", () => {
  it("includes bases, categories, and stack presets", () => {
    const text = summarizeKitCatalog(sampleCatalog);
    expect(text).toContain("voron_2_4");
    expect(text).toContain("Voron-2");
    expect(text).toContain("toolhead");
    expect(text).toContain("v24_sb_tap");
    expect(text).toContain("probe=tap");
  });
});

describe("buildAssistantSystemPrompt", () => {
  it("includes hard rules and catalog summary without inventing secrets", () => {
    const prompt = buildAssistantSystemPrompt({
      catalog: sampleCatalog,
      workflowGuide: "# Workflow\nSources then Build.",
    });
    expect(prompt).toContain("Never invent STLs");
    expect(prompt).toContain("Advise only");
    expect(prompt).toContain("Effects cheat sheet");
    expect(prompt).toContain("voron_2_4");
    expect(prompt).toContain("Sources then Build");
    expect(prompt).not.toContain("ANTHROPIC");
    expect(prompt).not.toContain("api_key");
  });

  it("omits plan snapshot when planId is missing", () => {
    const prompt = buildAssistantSystemPrompt({ catalog: sampleCatalog });
    expect(prompt).not.toContain("Active plan snapshot");
  });

  it("documents that other builds are examples not training", () => {
    const prompt = buildAssistantSystemPrompt({ catalog: sampleCatalog });
    expect(prompt).toMatch(/few-shot examples for context only/i);
    expect(prompt).toMatch(/not training/i);
  });
});
