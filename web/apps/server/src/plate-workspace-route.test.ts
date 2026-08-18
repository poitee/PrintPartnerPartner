/**
 * End-to-end HTTP test for GET /plans/:id/plate-workspace — the endpoint
 * fetchPlateWorkspace() calls to feed the UI plate group cards.
 *
 * The cards read `height_band` off preview[].plates[].items and summarise it
 * into the badge (apps/web/src/lib/plateHeightBand.ts). Unit-testing
 * packPreviewForPrinters covers the serializer, but this pins the whole route:
 * real repo → real STL files on disk → mesh load → classifyHeightBand → JSON.
 */

import { afterEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";
import { createSelfHostPorts } from "./adapters/self-host/index.js";

async function makeApp(dir: string) {
  process.env.PRINT_PARTNER_DATA_DIR = dir;
  delete process.env.PRINT_PARTNER_API_KEY;
  const config = loadConfig();
  const ports = createSelfHostPorts(dir);
  await ports.db.connect();
  const app = await buildApp(config, ports);
  return { app, ports, repo: ports.repository };
}

/** Minimal ASCII STL whose Z-extent is exactly `heightMm`. */
function stlWithHeight(heightMm: number): string {
  return `solid t
  facet normal 0 0 1
    outer loop
      vertex 0 0 0
      vertex 10 0 0
      vertex 0 10 ${heightMm}
    endloop
  endfacet
endsolid t
`;
}

type WorkspaceBody = {
  plan: { grouping_strategy?: string };
  preview: Array<{
    printer_id: string;
    plates: Array<{
      index: number;
      group_label: string;
      items: Array<{ filename: string; height_band?: string; height_mm: number }>;
    }>;
  }>;
  plate_count: number;
  warnings: string[];
};

describe("GET /plans/:id/plate-workspace height bands", () => {
  afterEach(() => {
    delete process.env.PRINT_PARTNER_DATA_DIR;
  });

  it("returns a height_band on every placed item so the cards can label plates", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pp-ws-http-"));
    const { app, ports, repo } = await makeApp(dir);
    try {
      // A source repo holding two parts of very different heights.
      const source = repo.createSource({
        name: "BandRepo",
        url: "https://github.com/a/bands",
      });
      const repoPath = join(dir, "repos", String(source.id));
      mkdirSync(join(repoPath, "parts"), { recursive: true });
      writeFileSync(join(repoPath, "parts", "flat.stl"), stlWithHeight(5));
      writeFileSync(join(repoPath, "parts", "tall.stl"), stlWithHeight(200));
      repo.updateSource(source.id, { local_path: repoPath });

      const plan = repo.createProfile("BandPlan", source.id);
      // Scan the repo's STLs into the plan's parts table.
      await repo.recomputeProfile(plan.id);

      // A printer must exist and be enabled for anything to be packed.
      const printerRes = await app.inject({
        method: "POST",
        url: "/printers",
        payload: { name: "Bandsaw", bed_width_mm: 200, bed_depth_mm: 200 },
      });
      expect(printerRes.statusCode).toBeLessThan(300);
      const printerId = (printerRes.json() as { id: string }).id;

      await app.inject({
        method: "PUT",
        url: `/plans/${plan.id}/print-plan`,
        payload: { enabled_printer_ids: [printerId] },
      });

      // Assign every print group to the printer, so parts actually get packed.
      const groupsRes = await app.inject({
        method: "GET",
        url: `/plans/${plan.id}/print-groups`,
      });
      const groups = (groupsRes.json() as { groups: Array<{ group_key: string }> }).groups;
      expect(groups.length).toBeGreaterThan(0);
      await app.inject({
        method: "PUT",
        url: `/plans/${plan.id}/print-assignments`,
        payload: {
          assignments: Object.fromEntries(groups.map((g) => [g.group_key, printerId])),
        },
      });

      const res = await app.inject({
        method: "GET",
        url: `/plans/${plan.id}/plate-workspace`,
      });
      expect(res.statusCode).toBe(200);
      const body = res.json() as WorkspaceBody;

      const items = body.preview.flatMap((bed) => bed.plates.flatMap((p) => p.items));
      expect(items.length).toBeGreaterThan(0);

      // The contract the UI depends on: every item carries a usable band.
      const known = new Set(["flat", "short", "medium", "tall", "very-tall"]);
      for (const item of items) {
        expect(known.has(String(item.height_band))).toBe(true);
      }

      // And the bands are the right ones for these known STL Z-extents.
      const byName = new Map(items.map((i) => [i.filename, i.height_band]));
      expect(byName.get("flat.stl")).toBe("flat");
      expect(byName.get("tall.stl")).toBe("tall");

      // Default strategy is location, which puts these two on one mixed plate
      // — the case the card badge renders as a "Flat–Tall" span.
      expect(body.plan.grouping_strategy ?? "location").toBe("location");
    } finally {
      await app.close();
      await ports.db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("re-packs into uniform-band plates when the strategy is height_band", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pp-ws-http-band-"));
    const { app, ports, repo } = await makeApp(dir);
    try {
      const source = repo.createSource({
        name: "BandRepo2",
        url: "https://github.com/a/bands2",
      });
      const repoPath = join(dir, "repos", String(source.id));
      mkdirSync(join(repoPath, "parts"), { recursive: true });
      writeFileSync(join(repoPath, "parts", "flat.stl"), stlWithHeight(5));
      writeFileSync(join(repoPath, "parts", "tall.stl"), stlWithHeight(200));
      repo.updateSource(source.id, { local_path: repoPath });

      const plan = repo.createProfile("BandPlan2", source.id);
      await repo.recomputeProfile(plan.id);

      const printerRes = await app.inject({
        method: "POST",
        url: "/printers",
        payload: { name: "Bandsaw2", bed_width_mm: 200, bed_depth_mm: 200 },
      });
      const printerId = (printerRes.json() as { id: string }).id;

      const groupsRes = await app.inject({
        method: "GET",
        url: `/plans/${plan.id}/print-groups`,
      });
      const groups = (groupsRes.json() as { groups: Array<{ group_key: string }> }).groups;
      await app.inject({
        method: "PUT",
        url: `/plans/${plan.id}/print-assignments`,
        payload: {
          assignments: Object.fromEntries(groups.map((g) => [g.group_key, printerId])),
        },
      });

      // This is exactly what the panel's strategy switch does.
      const saved = await app.inject({
        method: "PUT",
        url: `/plans/${plan.id}/print-plan`,
        payload: { grouping_strategy: "height_band", enabled_printer_ids: [printerId] },
      });
      expect(saved.statusCode).toBeLessThan(300);

      const res = await app.inject({
        method: "GET",
        url: `/plans/${plan.id}/plate-workspace`,
      });
      const body = res.json() as WorkspaceBody;
      expect(body.plan.grouping_strategy).toBe("height_band");

      const plates = body.preview.flatMap((bed) => bed.plates);
      expect(plates.length).toBe(2);
      // Each plate holds exactly one band → the card badge shows one band name.
      for (const plate of plates) {
        const bands = new Set(plate.items.map((i) => i.height_band));
        expect(bands.size).toBe(1);
      }
      expect(plates.map((p) => p.items[0].height_band)).toEqual(["flat", "tall"]);
    } finally {
      await app.close();
      await ports.db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("does not re-enable a disabled printer from a stale assignment pin", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pp-ws-http-stale-"));
    const { app, ports, repo } = await makeApp(dir);
    try {
      const source = repo.createSource({
        name: "StaleRepo",
        url: "https://github.com/a/stale",
      });
      const repoPath = join(dir, "repos", String(source.id));
      mkdirSync(join(repoPath, "parts"), { recursive: true });
      writeFileSync(join(repoPath, "parts", "bracket.stl"), stlWithHeight(20));
      repo.updateSource(source.id, { local_path: repoPath });
      const plan = repo.createProfile("StalePlan", source.id);
      await repo.recomputeProfile(plan.id);

      const voronRes = await app.inject({
        method: "POST",
        url: "/printers",
        payload: { name: "Voron", bed_width_mm: 200, bed_depth_mm: 200 },
      });
      const mk4Res = await app.inject({
        method: "POST",
        url: "/printers",
        payload: { name: "MK4", bed_width_mm: 200, bed_depth_mm: 200 },
      });
      const voronId = (voronRes.json() as { id: string }).id;
      const mk4Id = (mk4Res.json() as { id: string }).id;

      await app.inject({
        method: "PUT",
        url: `/plans/${plan.id}/print-plan`,
        payload: { enabled_printer_ids: [mk4Id] },
      });
      const groupsRes = await app.inject({
        method: "GET",
        url: `/plans/${plan.id}/print-groups`,
      });
      const groups = (groupsRes.json() as { groups: Array<{ group_key: string }> }).groups;
      expect(groups.length).toBeGreaterThan(0);

      const saved = await app.inject({
        method: "PUT",
        url: `/plans/${plan.id}/print-assignments`,
        payload: {
          assignments: {
            ...Object.fromEntries(groups.map((g) => [g.group_key, voronId])),
            extra: mk4Id,
          },
        },
      });
      expect(saved.statusCode).toBe(200);
      const body = saved.json() as {
        plan: { enabled_printer_ids: string[]; group_assignments: Record<string, string> };
      };
      expect(body.plan.enabled_printer_ids).toEqual([mk4Id]);
      expect(Object.values(body.plan.group_assignments)).toEqual([mk4Id]);
    } finally {
      await app.close();
      await ports.db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
