import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./SourcesPage.tsx", import.meta.url), "utf8");

describe("Library engine states", () => {
  it("shows connecting or offline before the empty-library state", () => {
    const offline = source.indexOf("Engine offline");
    const connecting = source.indexOf("Connecting to the engine");
    const empty = source.indexOf("No sources yet");

    expect(offline).toBeGreaterThanOrEqual(0);
    expect(connecting).toBeGreaterThanOrEqual(0);
    expect(empty).toBeGreaterThan(offline);
    expect(empty).toBeGreaterThan(connecting);
  });

  it("requires an okay engine before fetching or enabling mutations", () => {
    expect(source).toMatch(/if \(!health\?\.ok\) return/);
    expect(source).toMatch(/const engineReady = Boolean\(health\?\.ok\)/);
    expect(source).toMatch(/disabled=\{!engineReady\}/);
  });
});
