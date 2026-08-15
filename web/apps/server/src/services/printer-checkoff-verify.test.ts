import { describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { getDb, SqliteDatabase } from "../db/client.js";
import { AppRepository } from "../db/repository.js";
import {
  createPrinterCheckoffLink,
  getPrinterCheckoffLink,
  listAwaitingVerifyPrinterCheckoffLinks,
} from "./printer-checkoff-store.js";
import { reconcilePrinterCheckoff } from "./printer-checkoff.js";
import { verifyPrinterCheckoff } from "./printer-checkoff-verify.js";
import { summarizePrintOutcomes } from "./printer-outcomes-store.js";

function setupPlan() {
  const dir = mkdtempSync(join(tmpdir(), "pp-verify-"));
  const sqlite = new SqliteDatabase(dir);
  sqlite.connect();
  const repo = new AppRepository(getDb(sqlite), undefined, sqlite.reposDir);

  const source = repo.createSource({ name: "Repo", url: "https://github.com/a/b" });
  const repoPath = join(dir, "repos", String(source.id));
  mkdirSync(join(repoPath, "parts"), { recursive: true });
  writeFileSync(join(repoPath, "parts", "bracket.stl"), "solid");
  writeFileSync(join(repoPath, "parts", "frame.stl"), "solid");
  repo.updateSource(source.id, { local_path: repoPath });
  repo.updateImportRules(source.id, ["parts/"]);

  const plan = repo.createProfile("VerifyPlan", source.id);
  repo.recomputeProfile(plan.id);
  const parts = repo.listParts(plan.id).parts;
  const bracket = parts.find((p) => p.filename === "bracket.stl")!;
  const frame = parts.find((p) => p.filename === "frame.stl")!;
  expect(bracket).toBeTruthy();
  expect(frame).toBeTruthy();

  return { dir, sqlite, repo, plan, bracket, frame };
}

describe("printer checkoff verify-first flow", () => {
  it("complete queues awaiting_verify without ticking Progress", () => {
    const { dir, sqlite, repo, plan, bracket, frame } = setupPlan();
    const before = repo.printUnitsByPartId(plan.id);
    expect(before.get(bracket.id)?.every((u) => !u)).toBe(true);

    const link = createPrinterCheckoffLink(repo, {
      profile_id: plan.id,
      integration_id: "int-trident",
      printer_id: "printer-1",
      host_name: "Trident",
      filename: "plate.gcode",
      units: [
        { part_id: bracket.id, unit_index: 0 },
        { part_id: frame.id, unit_index: 0 },
      ],
    });
    expect(link?.state).toBe("watching");

    const updates = reconcilePrinterCheckoff(repo, "int-trident", {
      state: "complete",
      filename: "plate.gcode",
    });
    expect(updates).toEqual([
      expect.objectContaining({
        link_id: link!.id,
        event: "awaiting_verify",
        host_outcome: "success",
        units_pending: 2,
      }),
    ]);

    const queued = getPrinterCheckoffLink(repo, link!.id);
    expect(queued?.state).toBe("awaiting_verify");
    expect(queued?.host_outcome).toBe("success");
    expect(listAwaitingVerifyPrinterCheckoffLinks(repo, plan.id)).toHaveLength(1);

    const after = repo.printUnitsByPartId(plan.id);
    expect(after.get(bracket.id)).toEqual(before.get(bracket.id));
    expect(after.get(frame.id)).toEqual(before.get(frame.id));

    sqlite.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("confirm patches units; reject leaves unprinted and logs reason", () => {
    const { dir, sqlite, repo, plan, bracket, frame } = setupPlan();
    const link = createPrinterCheckoffLink(repo, {
      profile_id: plan.id,
      integration_id: "int-trident",
      printer_id: "printer-1",
      host_name: "Trident",
      filename: "plate.gcode",
      units: [
        { part_id: bracket.id, unit_index: 0 },
        { part_id: frame.id, unit_index: 0 },
      ],
    });
    reconcilePrinterCheckoff(repo, "int-trident", {
      state: "complete",
      filename: "plate.gcode",
    });

    const confirmed = verifyPrinterCheckoff(repo, link!.id, [
      { part_id: bracket.id, unit_index: 0, result: "confirmed" },
    ]);
    expect("error" in confirmed).toBe(false);
    if ("error" in confirmed) return;
    expect(confirmed.units_confirmed).toBeGreaterThanOrEqual(1);
    expect(confirmed.link.state).toBe("awaiting_verify");

    const units = repo.printUnitsByPartId(plan.id);
    expect(units.get(bracket.id)?.[0]).toBe(true);
    expect(units.get(frame.id)?.[0]).toBe(false);

    const rejected = verifyPrinterCheckoff(repo, link!.id, [
      {
        part_id: frame.id,
        unit_index: 0,
        result: "rejected",
        reason: "bed_adhesion",
        note: "peeled corner",
      },
    ]);
    expect("error" in rejected).toBe(false);
    if ("error" in rejected) return;
    expect(rejected.units_rejected).toBe(1);
    expect(rejected.link.state).toBe("verified");

    const afterReject = repo.printUnitsByPartId(plan.id);
    expect(afterReject.get(frame.id)?.[0]).toBe(false);

    const summary = summarizePrintOutcomes(repo, plan.id);
    expect(summary.total_confirmed).toBe(1);
    expect(summary.total_rejected).toBe(1);
    expect(summary.by_reason.bed_adhesion).toBe(1);

    sqlite.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("reject without reason is rejected by API sanitizer", () => {
    const { dir, sqlite, repo, plan, bracket } = setupPlan();
    const link = createPrinterCheckoffLink(repo, {
      profile_id: plan.id,
      integration_id: "int-trident",
      printer_id: "printer-1",
      host_name: "Trident",
      filename: "plate.gcode",
      units: [{ part_id: bracket.id, unit_index: 0 }],
    });
    reconcilePrinterCheckoff(repo, "int-trident", {
      state: "complete",
      filename: "plate.gcode",
    });

    const bad = verifyPrinterCheckoff(repo, link!.id, [
      { part_id: bracket.id, unit_index: 0, result: "rejected" },
    ]);
    expect(bad).toEqual(
      expect.objectContaining({
        status: 400,
        error: expect.stringMatching(/reason/i),
      }),
    );

    sqlite.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("host cancel marks host_failed without Progress ticks", () => {
    const { dir, sqlite, repo, plan, bracket } = setupPlan();
    const link = createPrinterCheckoffLink(repo, {
      profile_id: plan.id,
      integration_id: "int-trident",
      printer_id: "printer-1",
      host_name: "Trident",
      filename: "plate.gcode",
      units: [{ part_id: bracket.id, unit_index: 0 }],
      started: true,
    });
    // Observe active print first
    reconcilePrinterCheckoff(repo, "int-trident", {
      state: "printing",
      filename: "plate.gcode",
      progress: 20,
    });
    const updates = reconcilePrinterCheckoff(repo, "int-trident", {
      state: "idle",
    });
    expect(updates[0]?.event).toBe("host_failed");
    expect(getPrinterCheckoffLink(repo, link!.id)?.state).toBe("host_failed");
    expect(repo.printUnitsByPartId(plan.id).get(bracket.id)?.[0]).toBe(false);

    sqlite.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("unlabeled-only link persists and reloads with empty units", () => {
    const { dir, sqlite, repo, plan } = setupPlan();
    const link = createPrinterCheckoffLink(repo, {
      profile_id: plan.id,
      integration_id: "int-trident",
      printer_id: "printer-1",
      host_name: "Trident",
      filename: "mystery.gcode",
      units: [],
      unlabeled_names: ["Object_A", "Object_B"],
    });
    expect(link).not.toBeNull();
    expect(link!.units).toEqual([]);
    expect(link!.unlabeled_names).toEqual(["Object_A", "Object_B"]);
    expect(link!.state).toBe("watching");

    const loaded = getPrinterCheckoffLink(repo, link!.id);
    expect(loaded?.unlabeled_names).toEqual(["Object_A", "Object_B"]);
    expect(loaded?.units).toEqual([]);

    // GRE-232: plan-only bind (no units / unlabeled) is allowed so Send stamps plan_id.
    const planOnly = createPrinterCheckoffLink(repo, {
      profile_id: plan.id,
      integration_id: "int-trident",
      printer_id: "printer-1",
      host_name: "Trident",
      filename: "empty.gcode",
      units: [],
    });
    expect(planOnly).not.toBeNull();
    expect(planOnly!.units).toEqual([]);
    expect(planOnly!.unlabeled_names).toBeUndefined();
    expect(planOnly!.profile_id).toBe(plan.id);
    expect(getPrinterCheckoffLink(repo, planOnly!.id)?.profile_id).toBe(plan.id);

    sqlite.close();
    rmSync(dir, { recursive: true, force: true });
  });
});
