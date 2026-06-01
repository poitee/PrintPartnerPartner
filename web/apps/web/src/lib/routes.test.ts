import { describe, expect, it } from "vitest";
import {
  buildRoute,
  checkoffRoute,
  isBuildPath,
  isKitStudioPath,
  isPlanWorkflowPath,
  isReviewPath,
  planRoute,
  planStudioRoute,
  plateRoute,
  reviewRoute,
  withProfile,
} from "./routes";

describe("withProfile", () => {
  it("appends profile query when id is set", () => {
    expect(withProfile("/plate", 42)).toBe("/plate?profile=42");
  });

  it("leaves path unchanged when id is null", () => {
    expect(withProfile("/plate", null)).toBe("/plate");
  });

  it("uses ampersand when path already has query", () => {
    expect(withProfile("/plate?foo=1", 3)).toBe("/plate?foo=1&profile=3");
  });
});

describe("planStudioRoute", () => {
  it("redirects legacy studio links to build", () => {
    expect(planStudioRoute(7)).toBe("/build?profile=7");
  });
});

describe("workflow routes", () => {
  it("build, review, and plate include profile when provided", () => {
    expect(buildRoute(5)).toBe("/build?profile=5");
    expect(planRoute(5)).toBe("/build?profile=5");
    expect(reviewRoute(5)).toBe("/review?profile=5");
    expect(plateRoute(5)).toBe("/review?profile=5");
    expect(checkoffRoute(5)).toBe("/checkoff?profile=5");
  });
});

describe("path matchers", () => {
  it("detects kit studio paths", () => {
    expect(isKitStudioPath("/plans/12/studio")).toBe(true);
    expect(isKitStudioPath("/build")).toBe(false);
  });

  it("detects build paths", () => {
    expect(isBuildPath("/build")).toBe(true);
    expect(isBuildPath("/plan")).toBe(true);
    expect(isReviewPath("/review")).toBe(true);
  });

  it("detects plan workflow paths", () => {
    expect(isPlanWorkflowPath("/build")).toBe(true);
    expect(isPlanWorkflowPath("/plan")).toBe(true);
    expect(isPlanWorkflowPath("/review")).toBe(true);
    expect(isPlanWorkflowPath("/plans/3/studio")).toBe(true);
    expect(isPlanWorkflowPath("/plate")).toBe(false);
  });
});
