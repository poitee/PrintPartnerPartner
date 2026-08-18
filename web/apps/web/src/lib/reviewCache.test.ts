import { describe, expect, it } from "vitest";
import { optimisticReviewCacheKey, rollbackOptimisticCache } from "./reviewCache";

describe("optimistic review cache decisions", () => {
  it("targets the active included/excluded review variant", () => {
    expect(optimisticReviewCacheKey(12, false)).toEqual(["planReview", 12, false]);
    expect(optimisticReviewCacheKey(12, true)).toEqual(["planReview", 12, true]);
  });

  it("restores an existing cache entry on rollback", () => {
    const previous = { profile_id: 12 };

    expect(rollbackOptimisticCache(previous)).toEqual({
      kind: "restore",
      previous,
    });
  });

  it("removes a synthetic cache entry on rollback", () => {
    expect(rollbackOptimisticCache(undefined)).toEqual({ kind: "remove" });
  });
});
