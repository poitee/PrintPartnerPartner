import { describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";
import { createSelfHostPorts } from "./adapters/self-host/index.js";
import {
  resolveCaseInsensitiveRepoPath,
  resolvePartStl,
} from "./services/part-paths.js";

describe("Build persistence and STL preview", () => {
  it("resolves STL paths case-insensitively on disk", () => {
    const dir = mkdtempSync(join(tmpdir(), "pp-case-"));
    mkdirSync(join(dir, "Probes", "KlickyProbe", "STL"), { recursive: true });
    const stlPath = join(dir, "Probes", "KlickyProbe", "STL", "1mm_Spacer.stl");
    writeFileSync(stlPath, "solid test");
    const resolved = resolveCaseInsensitiveRepoPath(
      dir,
      "probes/klickyprobe/stl/1mm_spacer.stl",
    );
    expect(resolved).toBe(stlPath);
    rmSync(dir, { recursive: true, force: true });
  });

  it("persists import rules, part patches, and serves mesh over HTTP", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pp-build-"));
    process.env.PRINT_PARTNER_DATA_DIR = dir;
    const config = loadConfig();
    const ports = createSelfHostPorts(dir);
    await ports.db.connect();
    const repo = ports.repository!;

    const source = repo.createSource({ name: "MeshRepo", url: "https://github.com/a/b" });
    const repoPath = join(dir, "repos", String(source.id));
    mkdirSync(join(repoPath, "parts"), { recursive: true });
    writeFileSync(join(repoPath, "parts", "bracket.stl"), "solid bracket");
    repo.updateSource(source.id, { local_path: repoPath });
    repo.updateImportRules(source.id, ["parts/"]);

    const plan = repo.createProfile("PersistPlan", source.id);
    repo.recomputeProfile(plan.id);
    const parts = repo.listParts(plan.id).parts;
    expect(parts.length).toBe(1);
    const partId = parts[0]!.id;

    repo.bulkSetRoleFilament(plan.id, "primary", "pla-black", null);
    repo.patchPart(partId, { included: false, quantity_override: 3 });

    const reloaded = repo.listParts(plan.id).parts[0]!;
    expect(reloaded.included).toBe(false);
    expect(reloaded.quantity_effective).toBe(3);

    repo.recomputeProfile(plan.id);
    const afterRecompute = repo.listParts(plan.id).parts[0]!;
    expect(afterRecompute.included).toBe(false);
    expect(afterRecompute.quantity_effective).toBe(3);
    expect(afterRecompute.filament_color_id).toBe("pla-black");

    const partRow = repo.getPartRow(partId)!;
    expect(resolvePartStl(repo, partRow)).toContain("bracket.stl");

    const app = await buildApp(config, ports);
    const rulesRes = await app.inject({
      method: "PUT",
      url: `/sources/${source.id}/import-rules`,
      payload: { rules: ["parts/"] },
    });
    expect(rulesRes.statusCode).toBe(200);

    const kitRes = await app.inject({
      method: "PUT",
      url: `/plans/${plan.id}/kit-manifest`,
      payload: {
        kit: { name: "test", selections: { head: "sb" }, layers: [], include: [], exclude: [] },
      },
    });
    expect(kitRes.statusCode).toBe(200);
    const kitBody = kitRes.json() as { kit?: { selections?: Record<string, string> } };
    expect(kitBody.kit?.selections?.head).toBe("sb");

    const kitGet = await app.inject({
      method: "GET",
      url: `/plans/${plan.id}/kit-manifest`,
    });
    expect(kitGet.statusCode).toBe(200);
    const kitGetBody = kitGet.json() as { kit?: { selections?: Record<string, string> } };
    expect(kitGetBody.kit?.selections?.head).toBe("sb");

    const meshRes = await app.inject({ method: "GET", url: `/parts/${partId}/mesh` });
    expect(meshRes.statusCode).toBe(200);
    expect(meshRes.headers["content-type"]).toContain("model/stl");
    expect(meshRes.rawPayload.length).toBeGreaterThan(0);

    const narrowRules = await app.inject({
      method: "PUT",
      url: `/sources/${source.id}/import-rules`,
      payload: { rules: ["parts/bracket.stl"] },
    });
    expect(narrowRules.statusCode).toBe(200);

    repo.recomputeProfile(plan.id);

    const partsRes = await app.inject({ method: "GET", url: `/plans/${plan.id}/parts` });
    expect(partsRes.statusCode).toBe(200);
    const partsBody = partsRes.json() as { parts: Array<{ filename: string; included: boolean }> };
    expect(partsBody.parts.some((p) => p.filename === "bracket.stl")).toBe(true);
    expect(partsBody.parts[0]?.included).toBe(false);

    const rulesGet = await app.inject({ method: "GET", url: `/sources/${source.id}/import-rules` });
    const rulesBody = rulesGet.json() as { rules: string[] };
    expect(rulesBody.rules).toContain("parts/bracket.stl");

    await app.close();
    await ports.db.close();
    rmSync(dir, { recursive: true, force: true });
  });
});
