import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { AppRepository } from "../db/repository.js";
import { InProcessJobRunner } from "./jobs.js";

const dirs: string[] = [];

function createRunner(options?: { completedJobMax?: number; completedJobRetentionMs?: number }) {
  const dataDir = mkdtempSync(join(tmpdir(), "pp-jobs-tenant-"));
  dirs.push(dataDir);
  const repo = {
    getSetting: () => null,
  } as unknown as AppRepository;
  return new InProcessJobRunner(
    {
      getRepo: () => repo,
      reposDir: join(dataDir, "repos"),
      exportsDir: join(dataDir, "exports"),
      dataDir,
    },
    options,
  );
}

async function waitForTerminal(
  runner: InProcessJobRunner,
  jobId: string,
  tenantId: string,
): Promise<void> {
  for (let i = 0; i < 100; i += 1) {
    const snapshot = await runner.get(jobId, tenantId);
    if (snapshot?.status === "done" || snapshot?.status === "error") return;
    await new Promise<void>((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`Job ${jobId} did not finish`);
}

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("InProcessJobRunner tenant ownership", () => {
  it("hides get, list, and subscribe from a different tenant", async () => {
    const runner = createRunner();
    const jobId = await runner.start("tenant-test", {}, "tenant-a");
    await waitForTerminal(runner, jobId, "tenant-a");

    expect(await runner.get(jobId, "tenant-a")).not.toBeNull();
    expect(await runner.get(jobId, "tenant-b")).toBeNull();
    expect(runner.listJobs({}, "tenant-a").map((job) => job.job_id)).toContain(jobId);
    expect(runner.listJobs({}, "tenant-b")).toEqual([]);
    expect(runner.subscribe(jobId, "tenant-b", () => undefined)).toBeNull();
    expect(runner.subscribe(jobId, "tenant-a", () => undefined)).toBeTypeOf("function");
  });

  it("evicts the oldest terminal snapshots while retaining active jobs", async () => {
    const runner = createRunner({
      completedJobMax: 2,
      completedJobRetentionMs: 60_000,
    });
    const first = await runner.start("first", {}, "tenant-a");
    const second = await runner.start("second", {}, "tenant-a");
    const third = await runner.start("third", {}, "tenant-a");
    await waitForTerminal(runner, third, "tenant-a");

    const retained = runner.listJobs({}, "tenant-a");
    expect(retained).toHaveLength(2);
    expect(retained.map((job) => job.job_id)).not.toContain(first);
    expect(retained.map((job) => job.job_id)).toContain(second);
    expect(await runner.get(first, "tenant-a")).toBeNull();
  });
});
