import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./ProfileContext.tsx", import.meta.url), "utf8");

describe("ProfileProvider list failures", () => {
  it("reconciles selection only after a successful profile-list request", () => {
    expect(source).toMatch(/\bisSuccess\b/);
    expect(source).toMatch(/if \(!isSuccess\) return/);
    expect(source).not.toMatch(/if \(!isFetched\) return/);
  });
});
