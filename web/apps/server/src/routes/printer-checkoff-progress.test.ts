import Fastify from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { getDb, SqliteDatabase } from "../db/client.js";
import { AppRepository } from "../db/repository.js";
import { registerPrinterCheckoffRoutes } from "./printer-checkoff.js";
import { createIntegrationPort } from "../integrations/store.js";
import { getIntegrationAdapter } from "../integrations/registry.js";
import {
  createPrinterCheckoffLink,
  getPrinterCheckoffLink,
} from "../services/printer-checkoff-store.js";
import { reconcilePrinterCheckoff } from "../services/printer-checkoff.js";
import {
  createUnattributedPrint,
  listUnattributedPrints,
  saveUnattributedPrint,
} from "../services/unattributed-print-store.js";

const cleanup: Array<() => Promise<void>> = [];

afterEach(async () => {
  vi.unstubAllGlobals();
  for (const fn of cleanup.splice(0)) await fn();
});

async function setup() {
  const dir = mkdtempSync(join(tmpdir(), "pp-printer-checkoff-progress-"));
  const sqlite = new SqliteDatabase(dir);
  sqlite.connect();
  const repo = new AppRepository(getDb(sqlite), undefined, sqlite.reposDir);
  const source = repo.createSource({ name: "Repo", url: "https://github.com/a/b" });
  const repoPath = join(dir, "repos", String(source.id));
  mkdirSync(join(repoPath, "parts"), { recursive: true });
  writeFileSync(join(repoPath, "parts", "bracket.stl"), "solid");
  repo.updateSource(source.id, { local_path: repoPath });
  repo.updateImportRules(source.id, ["parts/"]);
  const plan = repo.createProfile("Progress", source.id);
  repo.recomputeProfile(plan.id);
  const bracket = repo.listParts(plan.id).parts.find((p) => p.filename === "bracket.stl")!;

  repo.setSetting("integrations", JSON.stringify([{
    id: "prusa-1",
    type: "prusalink",
    name: "Core One",
    config: { base_url: "http://127.0.0.1", username: "maker", password: "secret" },
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }]));
  repo.setSetting("printer.plan_bindings", JSON.stringify([{
    integration_id: "prusa-1",
    profile_id: plan.id,
    updated_at: new Date().toISOString(),
  }]));

  const integrations = createIntegrationPort({ repo, getAdapter: getIntegrationAdapter });
  const app = Fastify();
  await registerPrinterCheckoffRoutes(app, { repo, integrations });
  cleanup.push(async () => {
    await app.close();
    sqlite.close();
    rmSync(dir, { recursive: true, force: true });
  });
  return { app, repo, plan, bracket, repoPath };
}

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("printer progress route", () => {
  it("spends one object group's copy budget once across colliding library stems", async () => {
    const { app, repo, plan, repoPath } = await setup();
    writeFileSync(join(repoPath, "parts", "bracket.stl.stl"), "solid");
    repo.recomputeProfile(plan.id);
    const collidingParts = repo
      .getProfilePartRows(plan.id)
      .filter((part) => part.filename === "bracket.stl" || part.filename === "bracket.stl.stl");
    expect(collidingParts).toHaveLength(2);

    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("/api/v1/status")) {
        return response({
          printer: { state: "PRINTING" },
          job: { progress: 42, file: { display_name: "bracket.bgcode" } },
        });
      }
      if (url.includes("/api/v1/job")) {
        return response({
          state: "PRINTING",
          file: { display_name: "bracket.bgcode" },
          refs: { download: "/usb/bracket.bgcode" },
        });
      }
      if (url.includes("/usb/bracket.bgcode")) {
        return new Response('objects_info={"objects":[{"name":"bracket_01"}]}', { status: 206 });
      }
      return response({});
    }));

    const reconcile = await app.inject({
      method: "POST",
      url: "/printer-checkoff/reconcile",
      payload: { integration_id: "prusa-1" },
    });

    expect(reconcile.statusCode).toBe(200);
    expect(reconcile.json().created_links[0].units).toEqual([
      { part_id: collidingParts[0]!.id, unit_index: 0 },
    ]);
  });

  it("maps a currently printing Prusa unit label and reports the created link", async () => {
    const { app, repo, plan } = await setup();
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("/api/v1/status")) {
        return response({
          printer: { state: "PRINTING" },
          job: { progress: 42, file: { display_name: "bracket.bgcode" } },
        });
      }
      if (url.includes("/api/v1/job")) {
        return response({
          state: "PRINTING",
          file: { display_name: "bracket.bgcode" },
          refs: { download: "/usb/bracket.bgcode" },
        });
      }
      if (url.includes("/usb/bracket.bgcode")) {
        return new Response('objects_info={"objects":[{"name":"bracket_01"}]}', { status: 206 });
      }
      return response({});
    }));

    const reconcile = await app.inject({
      method: "POST",
      url: "/printer-checkoff/reconcile",
      payload: { integration_id: "prusa-1" },
    });
    expect(reconcile.statusCode).toBe(200);
    expect(reconcile.json()).toMatchObject({
      status: { state: "printing", filename: "bracket.bgcode" },
      updates: [],
      created_links: [{
        profile_id: plan.id,
        filename: "bracket.bgcode",
        units: [{ part_id: expect.any(Number), unit_index: 0 }],
      }],
    });

    const watching = await app.inject({
      method: "GET",
      url: `/printer-checkoff?state=watching&profile_id=${plan.id}`,
    });
    expect(watching.json()).toMatchObject({
      links: [{
        filename: "bracket.bgcode",
        units: [{ part_id: expect.any(Number), unit_index: 0 }],
      }],
    });
    expect(repo.printUnitsByPartId(plan.id).values().next().value).toEqual([false]);
  });

  it("returns virtual units for a legacy zero-unit awaiting card without persisting on GET", async () => {
    const { app, repo, plan, bracket } = await setup();
    const link = createPrinterCheckoffLink(repo, {
      profile_id: plan.id,
      integration_id: "prusa-1",
      printer_id: "core-one",
      host_name: "Core One",
      filename: "bracket.bgcode",
      units: [],
    })!;
    reconcilePrinterCheckoff(repo, "prusa-1", {
      state: "complete",
      filename: "bracket.bgcode",
    });
    const setSetting = vi.spyOn(repo, "setSetting");
    const ensureProgressForPart = vi.spyOn(repo, "ensureProgressForPart");

    const awaiting = await app.inject({
      method: "GET",
      url: `/printer-checkoff?state=awaiting_verify&profile_id=${plan.id}`,
    });
    expect(awaiting.json()).toMatchObject({
      links: [{
        id: link.id,
        units: [{ part_id: bracket.id, unit_index: 0 }],
      }],
    });
    expect(getPrinterCheckoffLink(repo, link.id)?.units).toEqual([]);
    expect(ensureProgressForPart).not.toHaveBeenCalled();
    expect(setSetting).not.toHaveBeenCalled();
  });

  it("caches an unrepairable link scan across immediate GET polls without writes", async () => {
    const { app, repo, plan } = await setup();
    const link = createPrinterCheckoffLink(repo, {
      profile_id: plan.id,
      integration_id: "prusa-1",
      printer_id: "core-one",
      host_name: "Core One",
      filename: "unknown.bgcode",
      units: [],
      unlabeled_names: ["not-a-library-part"],
    })!;
    reconcilePrinterCheckoff(repo, "prusa-1", {
      state: "complete",
      filename: "unknown.bgcode",
    });
    const getProfilePartRows = vi.spyOn(repo, "getProfilePartRows");
    const ensureProgressForPart = vi.spyOn(repo, "ensureProgressForPart");
    const setSetting = vi.spyOn(repo, "setSetting");

    const first = await app.inject({
      method: "GET",
      url: `/printer-checkoff?state=awaiting_verify&profile_id=${plan.id}`,
    });
    const second = await app.inject({
      method: "GET",
      url: `/printer-checkoff?state=awaiting_verify&profile_id=${plan.id}`,
    });

    expect(first.json().links[0]).toMatchObject({ id: link.id, units: [] });
    expect(second.json().links[0]).toMatchObject({ id: link.id, units: [] });
    expect(getProfilePartRows).toHaveBeenCalledTimes(1);
    expect(ensureProgressForPart).not.toHaveBeenCalled();
    expect(setSetting).not.toHaveBeenCalled();
  });

  it("repairs and persists an empty link only when verify applies confirm and reject decisions", async () => {
    const { app, repo, plan, bracket, repoPath } = await setup();
    writeFileSync(join(repoPath, "parts", "frame.stl"), "solid");
    repo.recomputeProfile(plan.id);
    const frame = repo.listParts(plan.id).parts.find((p) => p.filename === "frame.stl")!;
    const link = createPrinterCheckoffLink(repo, {
      profile_id: plan.id,
      integration_id: "prusa-1",
      printer_id: "core-one",
      host_name: "Core One",
      filename: "plate.bgcode",
      units: [],
      unlabeled_names: ["bracket_01", "frame_01"],
    })!;
    reconcilePrinterCheckoff(repo, "prusa-1", {
      state: "complete",
      filename: "plate.bgcode",
    });
    const stale = createUnattributedPrint(
      "prusa-1",
      "core-one",
      "Core One",
      "plate.bgcode",
      ["bracket_01", "frame_01"],
      [],
    );
    saveUnattributedPrint(repo, stale);

    const verify = await app.inject({
      method: "POST",
      url: "/printer-checkoff/verify",
      payload: {
        link_id: link.id,
        decisions: [
          { part_id: bracket.id, unit_index: 0, result: "confirmed" },
          {
            part_id: frame.id,
            unit_index: 0,
            result: "rejected",
            reason: "bed_adhesion",
          },
        ],
      },
    });
    expect(verify.statusCode).toBe(200);
    expect(verify.json()).toMatchObject({
      units_confirmed: 1,
      units_rejected: 1,
      link: {
        state: "verified",
        units: [
          { part_id: bracket.id, unit_index: 0 },
          { part_id: frame.id, unit_index: 0 },
        ],
      },
    });
    expect(getPrinterCheckoffLink(repo, link.id)?.units).toEqual([
      { part_id: bracket.id, unit_index: 0 },
      { part_id: frame.id, unit_index: 0 },
    ]);
    expect(repo.printUnitsByPartId(plan.id).get(bracket.id)).toEqual([true]);
    expect(repo.printUnitsByPartId(plan.id).get(frame.id)).toEqual([false]);
    expect(listUnattributedPrints(repo)).toContainEqual(expect.objectContaining({
      id: stale.id,
      claimed_profile_id: plan.id,
      claimed_at: expect.any(String),
    }));
  });

  it("persists Progress when the same API receives a valid mapped unit", async () => {
    const { app, repo, plan, bracket } = await setup();
    const link = createPrinterCheckoffLink(repo, {
      profile_id: plan.id,
      integration_id: "prusa-1",
      printer_id: "core-one",
      host_name: "Core One",
      filename: "bracket.bgcode",
      units: [{ part_id: bracket.id, unit_index: 0 }],
    })!;
    reconcilePrinterCheckoff(repo, "prusa-1", {
      state: "complete",
      filename: "bracket.bgcode",
    });

    const verify = await app.inject({
      method: "POST",
      url: "/printer-checkoff/verify",
      payload: {
        link_id: link.id,
        decisions: [{ part_id: bracket.id, unit_index: 0, result: "confirmed" }],
      },
    });
    expect(verify.statusCode).toBe(200);
    expect(verify.json()).toMatchObject({ units_confirmed: 1 });
    expect(repo.printUnitsByPartId(plan.id).get(bracket.id)).toEqual([true]);
  });

  it("does not attribute repeated complete polls for a linked print", async () => {
    const { app, repo, plan, bracket } = await setup();
    let printerState: "PRINTING" | "FINISHED" = "PRINTING";
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("/api/v1/status")) {
        return response({
          printer: { state: printerState },
          job: { progress: 100, file: { display_name: "bracket.bgcode" } },
        });
      }
      if (url.includes("/api/v1/job")) {
        return response({
          state: printerState,
          file: { display_name: "bracket.bgcode" },
          refs: { download: "/usb/bracket.bgcode" },
        });
      }
      if (url.includes("/usb/bracket.bgcode")) {
        return new Response('objects_info={"objects":[{"name":"bracket_01"}]}', { status: 206 });
      }
      return response({});
    }));

    const printing = await app.inject({
      method: "POST",
      url: "/printer-checkoff/reconcile",
      payload: { integration_id: "prusa-1" },
    });
    const link = printing.json().created_links[0];
    expect(link).toMatchObject({
      profile_id: plan.id,
      filename: "bracket.bgcode",
      units: [{ part_id: bracket.id, unit_index: 0 }],
    });

    printerState = "FINISHED";
    const complete = await app.inject({
      method: "POST",
      url: "/printer-checkoff/reconcile",
      payload: { integration_id: "prusa-1" },
    });
    expect(complete.json()).toMatchObject({
      updates: [{ link_id: link.id, event: "awaiting_verify" }],
      unattributed: [],
    });

    const repeatedComplete = await app.inject({
      method: "POST",
      url: "/printer-checkoff/reconcile",
      payload: { integration_id: "prusa-1" },
    });
    expect(repeatedComplete.json()).toMatchObject({
      updates: [],
      unattributed: [],
    });

    const verify = await app.inject({
      method: "POST",
      url: "/printer-checkoff/verify",
      payload: {
        link_id: link.id,
        decisions: [{ part_id: bracket.id, unit_index: 0, result: "confirmed" }],
      },
    });
    expect(verify.statusCode).toBe(200);
    expect(repo.printUnitsByPartId(plan.id).get(bracket.id)).toEqual([true]);

    const completeAfterVerify = await app.inject({
      method: "POST",
      url: "/printer-checkoff/reconcile",
      payload: { integration_id: "prusa-1" },
    });
    expect(completeAfterVerify.json()).toMatchObject({
      updates: [],
      unattributed: [],
    });
  });

  it("filters a linked unattributed duplicate on GET without persisting a claim", async () => {
    const { app, repo, plan } = await setup();
    const link = createPrinterCheckoffLink(repo, {
      profile_id: plan.id,
      integration_id: "prusa-1",
      printer_id: "core-one",
      host_name: "Core One",
      filename: "bracket.bgcode",
      units: [],
    })!;
    reconcilePrinterCheckoff(repo, "prusa-1", {
      state: "complete",
      filename: "bracket.bgcode",
    });
    const stale = createUnattributedPrint(
      "prusa-1",
      "core-one",
      "Core One",
      "BRACKET.BGCODE",
      ["bracket_01"],
      [],
    );
    saveUnattributedPrint(repo, stale);
    const setSetting = vi.spyOn(repo, "setSetting");

    const open = await app.inject({
      method: "GET",
      url: "/printer-checkoff/unattributed",
    });

    expect(open.json().prints).toEqual([]);
    expect(setSetting).not.toHaveBeenCalled();
    expect(listUnattributedPrints(repo)).toContainEqual(expect.objectContaining({
      id: stale.id,
      claimed_at: undefined,
      claimed_profile_id: undefined,
    }));
    expect(getPrinterCheckoffLink(repo, link.id)?.state).toBe("awaiting_verify");
  });

  it("filters a linked stale unattributed duplicate during reconcile without persisting a claim", async () => {
    const { app, repo, plan, bracket } = await setup();
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("/api/v1/status")) {
        return response({
          printer: { state: "FINISHED" },
          job: { progress: 100, file: { display_name: "BRACKET.BGCODE" } },
        });
      }
      if (url.includes("/api/v1/job")) {
        return response({
          state: "FINISHED",
          file: { display_name: "BRACKET.BGCODE" },
          refs: { download: "/usb/BRACKET.BGCODE" },
        });
      }
      if (url.includes("/usb/BRACKET.BGCODE")) {
        return new Response('objects_info={"objects":[{"name":"bracket_01"}]}', { status: 206 });
      }
      return response({});
    }));

    const link = createPrinterCheckoffLink(repo, {
      profile_id: plan.id,
      integration_id: "prusa-1",
      printer_id: "core-one",
      host_name: "Core One",
      filename: "bracket.bgcode",
      units: [{ part_id: bracket.id, unit_index: 0 }],
    })!;
    reconcilePrinterCheckoff(repo, "prusa-1", {
      state: "complete",
      filename: "bracket.bgcode",
    });

    const stale = createUnattributedPrint(
      "prusa-1",
      "core-one",
      "Core One",
      "bracket.bgcode",
      ["bracket_01"],
      [],
    );
    saveUnattributedPrint(repo, stale);
    const setSetting = vi.spyOn(repo, "setSetting");

    const repeatedComplete = await app.inject({
      method: "POST",
      url: "/printer-checkoff/reconcile",
      payload: { integration_id: "prusa-1" },
    });
    expect(repeatedComplete.json().unattributed).toEqual([]);
    expect(setSetting).not.toHaveBeenCalled();
    expect(listUnattributedPrints(repo)).toContainEqual(expect.objectContaining({
      id: stale.id,
      claimed_profile_id: undefined,
      claimed_at: undefined,
    }));
    expect(getPrinterCheckoffLink(repo, link.id)?.state).toBe("awaiting_verify");
    expect(repo.printUnitsByPartId(plan.id).get(bracket.id)).toEqual([false]);
  });

  it("creates an unattributed print for an unlinked external completion", async () => {
    const { app } = await setup();
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("/api/v1/status")) {
        return response({
          printer: { state: "FINISHED" },
          job: { file: { display_name: "external.bgcode" } },
        });
      }
      if (url.includes("/api/v1/job")) {
        return response({
          state: "FINISHED",
          file: { display_name: "external.bgcode" },
          refs: { download: "/usb/external.bgcode" },
        });
      }
      if (url.includes("/usb/external.bgcode")) {
        return new Response('objects_info={"objects":[{"name":"external_01"}]}', { status: 206 });
      }
      return response({});
    }));

    const complete = await app.inject({
      method: "POST",
      url: "/printer-checkoff/reconcile",
      payload: { integration_id: "prusa-1" },
    });
    expect(complete.statusCode).toBe(200);
    expect(complete.json()).toMatchObject({
      updates: [],
      unattributed: [{
        integration_id: "prusa-1",
        filename: "external.bgcode",
      }],
    });
  });
});
