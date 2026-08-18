import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./CheckoffPage.tsx", import.meta.url), "utf8");

describe("Progress failure feedback", () => {
  it("reports failed optimistic progress mutations to the operator", () => {
    expect(source).toMatch(/toggleUnit\([\s\S]*?\.catch\(\(e\)/);
    expect(source).toMatch(/toggleAssembled\([\s\S]*?\.catch\(\(e\)/);
    expect(source).toContain("Could not update print progress");
    expect(source).toContain("Could not update assembly progress");
  });

  it("does not swallow auxiliary fetch or claim failures", () => {
    expect(source).not.toMatch(/\.catch\(\(\)\s*=>\s*\{\s*\/\*\s*ignore\s*\*\/\s*\}\)/);
    expect(source).not.toMatch(/\.catch\(\(\)\s*=>\s*\{\s*\}\)/);
    expect(source).toContain("Could not refresh printer activity");
  });

  it("renders the engine state before progress mutation controls", () => {
    expect(source.indexOf("Engine offline")).toBeLessThan(
      source.indexOf("Add bag/sort"),
    );
    expect(source.indexOf("Connecting to the engine")).toBeLessThan(
      source.indexOf("Add bag/sort"),
    );
  });
});
