import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { importRulesForProject, scanRepo } from "@print-partner/domain";
import type { AppRepository } from "../db/repository.js";

const MANIFEST_FILE = "print-partner.manifest.yaml";

type RouteDeps = { repo: AppRepository };

function requireLocalPath(repo: AppRepository, sourceId: number) {
  const row = repo.getProjectRow(sourceId);
  if (!row?.localPath) throw new Error("Source has no local_path — sync or import first");
  return row;
}

export async function registerRepoManifestRoutes(
  app: FastifyInstance,
  deps: RouteDeps,
): Promise<void> {
  app.get("/sources/:id/repo-manifest", async (request) => {
    const id = Number((request.params as { id: string }).id);
    const row = requireLocalPath(deps.repo, id);
    const path = join(row.localPath!, MANIFEST_FILE);
    let yaml = "";
    let exists = false;
    try {
      yaml = readFileSync(path, "utf8");
      exists = true;
    } catch {
      yaml = [
        "format: print-partner-manifest-v2",
        "version: 2",
        `project: ${row.name}`,
        "parts: []",
      ].join("\n");
    }
    return {
      source_id: id,
      path: MANIFEST_FILE,
      exists,
      manifest_kind: exists ? "repo" : null,
      yaml,
      document: { format: "print-partner-manifest-v2", version: 2, raw: yaml },
    };
  });

  app.put("/sources/:id/repo-manifest", async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    const row = requireLocalPath(deps.repo, id);
    const body = request.body as { yaml?: string };
    const yaml = String(body.yaml ?? "");
    if (!yaml.trim()) return reply.status(400).send({ detail: "yaml is required" });
    writeFileSync(join(row.localPath!, MANIFEST_FILE), yaml, "utf8");
    return { source_id: id, saved: true };
  });

  app.get("/sources/:id/manifest-builder", async (request) => {
    const id = Number((request.params as { id: string }).id);
    const row = requireLocalPath(deps.repo, id);
    const rules = importRulesForProject(row.importedPaths);
    const scanned = scanRepo(row.localPath!, "base", rules);
    return {
      source_id: id,
      source: {
        id: row.id,
        name: row.name,
        url: row.url,
        branch: row.branch,
        local_path: row.localPath,
      },
      path: MANIFEST_FILE,
      yaml: "",
      document: { format: "print-partner-manifest-v2", version: 2, parts: [] },
      scanned_parts: scanned.map((p) => ({
        match: p.matchKey,
        relative_path: p.relativePath,
      })),
    };
  });

  app.get("/sources/:id/docs", async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    const row = deps.repo.getProjectRow(id);
    if (!row) return reply.status(404).send({ detail: "Source not found" });
    const docsUrl = row.docsUrl ?? row.url;
    return { source_id: id, docs_url: docsUrl, entries: [] };
  });

  app.get("/sources/:id/docs/*", async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    const row = requireLocalPath(deps.repo, id);
    const docPath = (request.params as { "*": string })["*"] ?? "";
    const safe = docPath.replace(/\.\./g, "");
    const full = join(row.localPath!, safe);
    try {
      const text = readFileSync(full, "utf8");
      return reply.type("text/plain; charset=utf-8").send(text);
    } catch {
      return reply.status(404).send({ detail: "Document not found" });
    }
  });
}
