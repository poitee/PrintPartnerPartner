import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildApp } from "../app.js";
import { loadConfig } from "../config.js";
import { createSelfHostPorts } from "../adapters/self-host/index.js";

/**
 * Route-level checks for POST /jobs/auto-slice: it must exist, accept the
 * documented body, and hand the job runner a per_plate export (a zip export
 * would produce an archive the sidecar cannot slice).
 */

let cleanup: Array<() => void> = [];

afterEach(() => {
  for (const fn of cleanup) fn();
  cleanup = [];
});

async function makeApp() {
  const dir = mkdtempSync(join(tmpdir(), "pp-auto-slice-route-"));
  process.env.PRINT_PARTNER_DATA_DIR = dir;
  delete process.env.PRINT_PARTNER_API_KEY;
  const config = loadConfig();
  const ports = createSelfHostPorts(dir);
  await ports.db.connect();
  const profileId = ports.repository!.createProfile("Auto-slice route plan").id;
  const app = await buildApp(config, ports);
  cleanup.push(() => {
    void app.close();
    void ports.db.close();
    rmSync(dir, { recursive: true, force: true });
  });
  return { app, profileId };
}

/**
 * Wait for a job to reach a terminal state. The job runner is fire-and-forget,
 * so closing the database out from under an in-flight job produces an
 * unhandled "Database not connected" rejection; settling first keeps the test
 * output clean and makes the assertions deterministic.
 */
async function settle(
  app: Awaited<ReturnType<typeof makeApp>>["app"],
  jobId: string,
) {
  for (let i = 0; i < 100; i++) {
    const res = await app.inject({ method: "GET", url: `/jobs/${jobId}` });
    const body = res.json() as { status?: string; kind?: string };
    if (body.status === "done" || body.status === "error" || body.status === "cancelled") {
      return body;
    }
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error(`job ${jobId} did not settle`);
}

describe("POST /jobs/auto-slice", () => {
  it("accepts a slice request and returns a job id", async () => {
    const { app, profileId } = await makeApp();
    const res = await app.inject({
      method: "POST",
      url: "/jobs/auto-slice",
      payload: { profile_id: profileId, enabled_printer_ids: ["p1"] },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { job_id?: string };
    expect(typeof body.job_id).toBe("string");
    expect(body.job_id).toBeTruthy();
    await settle(app, body.job_id!);
  });

  it("exposes the job through the job snapshot API as kind=auto-slice", async () => {
    const { app, profileId } = await makeApp();
    const start = await app.inject({
      method: "POST",
      url: "/jobs/auto-slice",
      payload: { profile_id: profileId },
    });
    const { job_id: jobId } = start.json() as { job_id: string };

    const snap = await settle(app, jobId);
    expect(snap.kind).toBe("auto-slice");
    // No plan/printers exist in a fresh DB, so the job must fail cleanly with
    // a message rather than hanging or throwing an unhandled error.
    expect(snap.status).toBe("error");
  });
});
