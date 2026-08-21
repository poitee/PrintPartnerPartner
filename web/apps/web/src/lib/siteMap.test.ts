import { describe, expect, it } from "vitest";
import {
  BUILD_SECTIONS,
  GLOBAL_SECTIONS,
  buildSectionFromPath,
  buildSectionPath,
  globalSectionFromPath,
  globalSectionPath,
  productionScopeFromSearch,
} from "./siteMap";

describe("site map", () => {
  it("names the four global sections and four Build destinations", () => {
    expect([...GLOBAL_SECTIONS]).toEqual(["builds", "production", "printers", "settings"]);
    expect([...BUILD_SECTIONS]).toEqual(["sources", "plan", "checkoff", "production"]);
  });

  it("uses Builds and Production as top-level paths", () => {
    expect(globalSectionPath("builds")).toBe("/builds");
    expect(globalSectionPath("production")).toBe("/production");
    expect(globalSectionPath("printers")).toBe("/printers");
    expect(globalSectionPath("settings")).toBe("/settings");
  });

  it("sends Build destinations through the existing page owners", () => {
    expect(buildSectionPath("sources", 7)).toBe("/sources?profile=7");
    expect(buildSectionPath("plan", 7)).toBe("/plan?profile=7");
    expect(buildSectionPath("checkoff", 7)).toBe("/progress?profile=7");
    expect(buildSectionPath("production", 7)).toBe("/production?profile=7");
  });

  it("maps current and legacy paths onto the accepted sections", () => {
    expect(globalSectionFromPath("/")).toBe("builds");
    expect(globalSectionFromPath("/plans")).toBe("builds");
    expect(globalSectionFromPath("/export")).toBe("production");
    expect(buildSectionFromPath("/sources")).toBe("sources");
    expect(buildSectionFromPath("/build")).toBe("sources");
    expect(buildSectionFromPath("/plan")).toBe("plan");
    expect(buildSectionFromPath("/parts")).toBe("plan");
    expect(buildSectionFromPath("/review")).toBe("plan");
    expect(buildSectionFromPath("/checkoff")).toBe("checkoff");
    expect(buildSectionFromPath("/export")).toBe("production");
    expect(buildSectionFromPath("/library")).toBeNull();
  });

  it("treats Production without a profile as global, with a profile as Build", () => {
    expect(productionScopeFromSearch("")).toBe("global");
    expect(productionScopeFromSearch("?")).toBe("global");
    expect(productionScopeFromSearch("?foo=1")).toBe("global");
    expect(productionScopeFromSearch("?profile=7")).toBe("build");
    expect(productionScopeFromSearch("profile=7")).toBe("build");
    expect(productionScopeFromSearch("?profile=0")).toBe("global");
  });
});
