import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { buildApp } from "../app.js";
import { loadConfig } from "../config.js";
import { createSelfHostPorts } from "../adapters/self-host/index.js";
import * as discordNotify from "../services/discord-notify.js";

async function makeApp(dir: string) {
  process.env.PRINT_PARTNER_DATA_DIR = dir;
  delete process.env.PRINT_PARTNER_API_KEY;
  const config = loadConfig();
  const ports = createSelfHostPorts(dir);
  await ports.db.connect();
  const app = await buildApp(config, ports);
  return { app, ports };
}

describe("POST /api/discord-digest", () => {
  afterEach(() => {
    delete process.env.PRINT_PARTNER_DATA_DIR;
    vi.restoreAllMocks();
  });

  it("reads print_jobs via the repository query builder (not a raw better-sqlite3 handle)", async () => {
    // Regression test: this route used to reach into `(repo as any).db.prepare(...)`,
    // but `repo.db` is a Drizzle wrapper with no `.prepare` method, so the counter
    // silently stayed at 0 on every run instead of throwing. Assert the real count
    // comes through end-to-end via the HTTP route.
    const dir = mkdtempSync(join(tmpdir(), "pp-discord-digest-"));
    const { app, ports } = await makeApp(dir);
    const repo = ports.repository!;

    repo.setSetting("discord_notify_webhook_url", "https://discord.example/webhook/abc");
    const sendSpy = vi
      .spyOn(discordNotify, "sendFarmDigest")
      .mockResolvedValue({ ok: true, status: 204, attempts: 1 });

    const plan = repo.createProfile("Overnight Run");
    const now = new Date().toISOString();
    for (let i = 0; i < 3; i++) {
      repo.insertPrintJob({
        id: randomUUID(),
        profileId: plan.id,
        printerId: "trident-r2",
        material: "LDO PLA",
        status: "completed",
        at: now,
        completedAt: now,
      });
    }

    const res = await app.inject({ method: "POST", url: "/api/discord-digest" });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { ok: boolean; plates_overnight: number };
    expect(body.ok).toBe(true);
    expect(body.plates_overnight).toBe(3);
    expect(sendSpy).toHaveBeenCalledTimes(1);

    await app.close();
    ports.db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("returns 422 when no webhook URL is configured", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pp-discord-digest-no-webhook-"));
    const { app, ports } = await makeApp(dir);

    const res = await app.inject({ method: "POST", url: "/api/discord-digest" });
    expect(res.statusCode).toBe(422);

    await app.close();
    ports.db.close();
    rmSync(dir, { recursive: true, force: true });
  });
});
