import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { FastifyInstance } from "fastify";
import { importRulesForProject, scanRepo } from "@print-partner/domain";
import type { AppRepository } from "../db/repository.js";
import { loadKitCatalog } from "../services/kit-catalog.js";
import { applyStackPresetToProfile } from "../services/stack-preset.js";
import { loadKitManifest, saveKitManifest } from "../services/kit-manifest-store.js";

const DATA_DIR = join(dirname(fileURLToPath(import.meta.url)), "../data/manifests");

type RouteDeps = { repo: AppRepository };

function loadRegistryIndex(): { entries: Array<Record<string, unknown>> } {
  try {
    const raw = readFileSync(join(DATA_DIR, "registry-index.yaml"), "utf8");
    const entries: Array<Record<string, unknown>> = [];
    let slug = "";
    for (const line of raw.split("\n")) {
      const slugMatch = line.match(/^\s+slug:\s*(.+)/);
      if (slugMatch) slug = slugMatch[1].trim();
      const repoMatch = line.match(/^\s+target_repo:\s*(.+)/);
      const titleMatch = line.match(/^\s+title:\s*(.+)/);
      const fileMatch = line.match(/^\s+manifest_file:\s*(.+)/);
      if (slug && repoMatch && titleMatch && fileMatch) {
        entries.push({
          slug,
          target_repo: repoMatch[1].trim(),
          title: titleMatch[1].trim(),
          manifest_file: fileMatch[1].trim(),
        });
      }
    }
    return { entries };
  } catch {
    return { entries: [] };
  }
}

export async function registerManifestRoutes(
  app: FastifyInstance,
  deps: RouteDeps,
): Promise<void> {
  app.get("/manifest-registry", async () => {
    const { entries } = loadRegistryIndex();
    return { entries };
  });

  app.get("/manifest-registry/:slug", async (request, reply) => {
    const slug = (request.params as { slug: string }).slug;
    const path = join(DATA_DIR, `${slug}.yaml`);
    try {
      const yaml = readFileSync(path, "utf8");
      return { slug, yaml, document: { format: "yaml", raw: true } };
    } catch {
      return reply.status(404).send({ detail: "Manifest not found" });
    }
  });

  app.post("/manifest-registry/export-draft", async () => ({
    slug: "draft",
    manifest_yaml: "format: print-partner-manifest-v2\nversion: 2\n",
    meta_yaml: "title: Draft\n",
    issue_body: "Community manifest draft (web stub).",
  }));

  app.get("/manifest-templates", async () => ({
    templates: [
      { id: "minimal", label: "Minimal kit", category: "starter", available: "builtin" },
    ],
  }));

  app.get("/manifest-templates/:id", async (request) => {
    const id = (request.params as { id: string }).id;
    return {
      id,
      label: "Minimal kit",
      category: "starter",
      yaml: "format: print-partner-manifest-v2\nversion: 2\nproject: Example\n",
      document: { format: "print-partner-manifest-v2", version: 2, project: "Example" },
    };
  });

  app.post("/sources/:id/manifest-draft", async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    const row = deps.repo.getProjectRow(id);
    if (!row?.localPath) {
      return reply.status(400).send({ detail: "Source has no local_path — sync first" });
    }
    const rules = importRulesForProject(row.importedPaths);
    const scanned = scanRepo(row.localPath, "base", rules);
    if (!scanned.length) {
      return reply.status(400).send({ detail: "No STL files found in project" });
    }
    const yaml = [
      "format: print-partner-manifest-v2",
      "version: 2",
      `project: ${row.name}`,
      "parts:",
      ...scanned.slice(0, 50).map((p) => `  - match: ${p.matchKey}`),
    ].join("\n");
    return { project_id: id, part_count: scanned.length, yaml };
  });

  app.get("/kit-catalog", async () => loadKitCatalog());

  app.post("/plans/:id/apply-stack-preset", async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    const body = request.body as { preset_id?: string };
    const presetId = String(body.preset_id ?? "").trim();
    if (!presetId) return reply.status(400).send({ detail: "preset_id is required" });
    if (!deps.repo.getProfile(id)) return reply.status(404).send({ detail: "Profile not found" });
    try {
      const result = applyStackPresetToProfile(deps.repo, id, presetId);
      const kit = loadKitManifest(deps.repo, id);
      kit.selections = result.selections;
      saveKitManifest(deps.repo, id, kit);
      return {
        profile_id: id,
        preset_id: presetId,
        missing_sources: result.missing_sources,
        layers: result.layers,
        selections: result.selections,
      };
    } catch (e) {
      return reply.status(400).send({ detail: e instanceof Error ? e.message : String(e) });
    }
  });
}
