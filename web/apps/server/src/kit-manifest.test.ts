import { describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createSelfHostPorts } from "./adapters/self-host/index.js";
import { loadKitManifest, saveKitManifest } from "./services/kit-manifest-store.js";
import {
  applyManifestToProfile,
  loadManifestYaml,
  selectionIncludesPart,
} from "./services/manifest-apply.js";
import { buildPlanManifestBuilder } from "./services/plan-manifest-builder.js";

describe("kit manifest store", () => {
  it("round-trips selections through save and load", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pp-kit-"));
    process.env.PRINT_PARTNER_DATA_DIR = dir;
    const ports = createSelfHostPorts(dir);
    await ports.db.connect();
    const repo = ports.repository!;

    const source = repo.createSource({ name: "Voron-2", url: "https://github.com/a/voron" });
    const repoPath = join(dir, "repos", String(source.id));
    mkdirSync(join(repoPath, "STLs", "stock_toolhead"), { recursive: true });
    mkdirSync(join(repoPath, "STLs", "stock_probe"), { recursive: true });
    writeFileSync(join(repoPath, "STLs", "stock_toolhead", "part.stl"), "solid a");
    writeFileSync(join(repoPath, "STLs", "stock_probe", "probe.stl"), "solid b");
    writeFileSync(
      join(repoPath, "print-partner.manifest.yaml"),
      `format: print-partner-manifest
version: 2
option_groups:
  toolhead:
    rule: pick_one
    variants:
      - id: stock
        parts: ["**/stock_toolhead/**"]
  probe:
    rule: pick_one
    variants:
      - id: stock
        parts: ["**/stock_probe/**"]
`,
    );
    repo.updateSource(source.id, { local_path: repoPath });
    repo.updateImportRules(source.id, ["STLs/"]);

    const plan = repo.createProfile("KitPlan", source.id);
    repo.recomputeProfile(plan.id);

    saveKitManifest(repo, plan.id, {
      selections: { toolhead: "stock", probe: "stock" },
    });
    const loaded = loadKitManifest(repo, plan.id);
    expect(loaded.selections).toEqual({ toolhead: "stock", probe: "stock" });

    const builder = buildPlanManifestBuilder(repo, plan.id);
    expect(Object.keys(builder.merged_option_groups)).toContain("toolhead");
    expect(builder.merged_option_groups.toolhead?.variants?.[0]?.id).toBe("stock");

    applyManifestToProfile(repo, plan.id, true);
    const parts = repo.listParts(plan.id).parts;
    expect(parts.every((p) => p.included)).toBe(true);

    saveKitManifest(repo, plan.id, { selections: { toolhead: "stock" } });
    applyManifestToProfile(repo, plan.id, true);
    const afterProbeClear = repo.listParts(plan.id).parts;
    expect(afterProbeClear.some((p) => p.match_key.includes("probe") && p.included)).toBe(false);

    await ports.db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("selectionIncludesPart matches variant globs", () => {
    const doc = loadManifestYaml(`option_groups:
  toolhead:
    rule: pick_one
    variants:
      - id: stealthburner
        parts: ["**/Stealthburner/**"]
`);
    const group = doc.option_groups!.toolhead!;
    expect(
      selectionIncludesPart("STLs/Stealthburner/hotend.stl", group, "stealthburner"),
    ).toBe(true);
    expect(selectionIncludesPart("STLs/stock_toolhead/part.stl", group, "stealthburner")).toBe(
      false,
    );
  });
});
