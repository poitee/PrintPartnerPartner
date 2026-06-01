import { describe, expect, it } from "vitest";
import {
  DEFAULT_NAMING_PROFILE,
  mergeNamingProfiles,
  namingProfileFromDict,
  resolveNamingProfile,
  validateNamingProfile,
} from "./stl-naming.js";
import { parseStlPath } from "./parsers.js";

describe("stl-naming", () => {
  it("default profile matches legacy parser", () => {
    const p = parseStlPath("parts/[a]_foo_x4.stl");
    expect(p.role).toBe("accent");
    expect(p.quantity).toBe(4);
  });

  it("supports custom accent marker", () => {
    const base = structuredClone(DEFAULT_NAMING_PROFILE);
    base.roles = [
      { id: "primary", label: "Primary", markers: [] },
      { id: "accent", label: "Accent", markers: ["[accent]"] },
      { id: "clear", label: "Clear", markers: ["[c]"] },
      { id: "opaque", label: "Opaque", markers: ["[o]"] },
    ];
    const profile = namingProfileFromDict(validateNamingProfile(base));
    expect(parseStlPath("parts/[accent]_bracket.stl", profile).role).toBe("accent");
  });

  it("resolves source override quantity", () => {
    const global = validateNamingProfile(DEFAULT_NAMING_PROFILE);
    const metadata = {
      naming: {
        use_defaults: false,
        override: { quantity: { regex: String.raw`_qty([0-9]+)\.stl$`, default: 1 } },
      },
    };
    const resolved = resolveNamingProfile(global, metadata);
    expect(parseStlPath("widget_qty3.stl", resolved).quantity).toBe(3);
  });

  it("rejects bad regex", () => {
    const bad = structuredClone(DEFAULT_NAMING_PROFILE);
    bad.quantity = { regex: "(invalid[", default: 1 };
    expect(() => validateNamingProfile(bad)).toThrow(/invalid/i);
  });

  it("requires capture group", () => {
    const bad = structuredClone(DEFAULT_NAMING_PROFILE);
    bad.quantity = { regex: String.raw`\.stl$`, default: 1 };
    expect(() => validateNamingProfile(bad)).toThrow(/capture group/i);
  });

  it("merges partial profiles", () => {
    const merged = mergeNamingProfiles(DEFAULT_NAMING_PROFILE, {
      quantity: { regex: String.raw`_n([0-9]+)\.stl$`, default: 1 },
    });
    const profile = namingProfileFromDict(merged);
    expect(parseStlPath("part_n5.stl", profile).quantity).toBe(5);
  });
});
