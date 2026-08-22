import { describe, expect, it } from "vitest";
import {
  globalProductionJobLabel,
  partitionGlobalProductionJobs,
  recentVerifiedJobs,
  toGlobalProductionJob,
} from "./globalProduction";

const names = new Map([
  [7, "Voron"],
  [8, "A1 Mini"],
]);

describe("toGlobalProductionJob", () => {
  it("maps active checkoff links onto Checkoff for that Build", () => {
    const job = toGlobalProductionJob(
      {
        id: "link-1",
        state: "awaiting_verify",
        profile_id: 7,
        host_name: "Core One",
        filename: "plate-01.gcode",
      },
      names,
    );
    expect(job).toEqual({
      id: "link-1",
      state: "awaiting_verify",
      profileId: 7,
      planName: "Voron",
      hostName: "Core One",
      filename: "plate-01.gcode",
      checkoffHref: "/progress?profile=7",
    });
  });

  it("drops verified and dismissed links from the active buckets", () => {
    expect(
      toGlobalProductionJob(
        {
          id: "done",
          state: "verified",
          profile_id: 7,
          host_name: "Core One",
          filename: "done.gcode",
        },
        names,
      ),
    ).toBeNull();
  });
});

describe("partitionGlobalProductionJobs", () => {
  it("splits watching, awaiting, and failed", () => {
    const jobs = [
      toGlobalProductionJob(
        { id: "w", state: "watching", profile_id: 7, host_name: "A", filename: "a.gcode" },
        names,
      )!,
      toGlobalProductionJob(
        { id: "v", state: "awaiting_verify", profile_id: 8, host_name: "B", filename: "b.gcode" },
        names,
      )!,
      toGlobalProductionJob(
        { id: "f", state: "host_failed", profile_id: 7, host_name: "C", filename: "c.gcode" },
        names,
      )!,
    ];
    const parts = partitionGlobalProductionJobs(jobs);
    expect(parts.watching.map((job) => job.id)).toEqual(["w"]);
    expect(parts.awaiting.map((job) => job.id)).toEqual(["v"]);
    expect(parts.failed.map((job) => job.id)).toEqual(["f"]);
  });
});

describe("recentVerifiedJobs", () => {
  it("keeps the newest verified work and labels the Build", () => {
    const recent = recentVerifiedJobs(
      [
        {
          id: "old",
          state: "verified",
          profile_id: 7,
          host_name: "A",
          filename: "old.gcode",
          completed_at: "2026-08-01T00:00:00Z",
          applied_at: "2026-08-01T00:00:00Z",
        },
        {
          id: "new",
          state: "verified",
          profile_id: 8,
          host_name: "B",
          filename: "new.gcode",
          completed_at: "2026-08-20T00:00:00Z",
          applied_at: "2026-08-21T00:00:00Z",
        },
      ],
      names,
      1,
    );
    expect(recent).toEqual([
      {
        id: "new",
        planName: "A1 Mini",
        filename: "new.gcode",
        at: "2026-08-21T00:00:00Z",
        checkoffHref: "/progress?profile=8",
      },
    ]);
  });
});

describe("globalProductionJobLabel", () => {
  it("labels the three live buckets", () => {
    expect(globalProductionJobLabel("watching")).toBe("Printing");
    expect(globalProductionJobLabel("awaiting_verify")).toBe("Awaiting verification");
    expect(globalProductionJobLabel("host_failed")).toBe("Failed");
  });
});
