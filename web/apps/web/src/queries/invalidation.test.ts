import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import type { JobSnapshot } from "../api/engine";
import { invalidateAfterJob } from "./invalidation";
import { queryKeys } from "./keys";

const completedUpdateCheck: JobSnapshot = {
  job_id: "job-1",
  kind: "check-source-updates",
  status: "done",
  message: "done",
  progress: 1,
  result: null,
  error: null,
};

const completedRecompute: JobSnapshot = {
  ...completedUpdateCheck,
  job_id: "job-2",
  kind: "recompute",
};

describe("job query invalidation", () => {
  it("invalidates shared Source and Plan summaries after an update check", () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(queryKeys.sources, []);
    queryClient.setQueryData(queryKeys.profiles, []);
    queryClient.setQueryData(queryKeys.planReview(3, false), { profile_id: 3 });

    invalidateAfterJob(
      queryClient,
      "check-source-updates",
      completedUpdateCheck,
    );

    expect(queryClient.getQueryState(queryKeys.sources)?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(queryKeys.profiles)?.isInvalidated).toBe(true);
    expect(
      queryClient.getQueryState(queryKeys.planReview(3, false))?.isInvalidated,
    ).toBe(true);
  });

  it("does not invalidate Source state when the update check fails", () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(queryKeys.sources, []);

    invalidateAfterJob(queryClient, "check-source-updates", {
      ...completedUpdateCheck,
      status: "error",
    });

    expect(queryClient.getQueryState(queryKeys.sources)?.isInvalidated).toBe(false);
  });

  it("invalidates recipe data after recompute", () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(queryKeys.planRecipeBundle(4), {});

    invalidateAfterJob(queryClient, "recompute", completedRecompute, 4);

    expect(
      queryClient.getQueryState(queryKeys.planRecipeBundle(4))?.isInvalidated,
    ).toBe(true);
  });
});
