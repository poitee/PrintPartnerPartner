import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const querySource = readFileSync(new URL("./planReview.ts", import.meta.url), "utf8");
const contextSource = readFileSync(
  new URL("../context/PlanWorkspaceContext.tsx", import.meta.url),
  "utf8",
);

describe("optimistic Progress cache selection", () => {
  it("updates the active included/excluded review cache", () => {
    expect(querySource).toMatch(
      /usePatchPartProgressMutation\([\s\S]*?includeExcluded = false/,
    );
    expect(querySource).toMatch(
      /usePatchPartAssembledMutation\([\s\S]*?includeExcluded = false/,
    );
    expect(querySource).toMatch(
      /queryKeys\.planReview\(profileId, includeExcluded\)/,
    );
    expect(contextSource).toContain(
      "usePatchPartProgressMutation(selectedProfileId, includeExcluded)",
    );
    expect(contextSource).toContain(
      "usePatchPartAssembledMutation(selectedProfileId, includeExcluded)",
    );
  });

  it("removes an optimistic cache entry when there was no previous value", () => {
    expect(querySource).toContain("hadPrevious");
    expect(querySource).toMatch(/removeQueries\(\{ queryKey: ctx\.key, exact: true \}\)/);
  });
});
