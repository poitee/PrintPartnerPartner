import { createReadStream, readFileSync, statSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import type { FastifyInstance } from "fastify";
import {
  buildStlTreePayload,
  DEFAULT_STL_SEARCH_LIMIT,
  safeRepoPath,
  searchSourceStls,
} from "@print-partner/domain";
import type { AppRepository } from "../db/repository.js";
import { resolveCaseInsensitiveRepoPath } from "../services/part-paths.js";
import { listGithubBranches, syncGithubSource } from "../services/github-sync.js";
import { writeUploadedZip } from "../services/archive-import.js";
import {
  cachedPngIfExists,
  globalPreviewPath,
  globalThumbnailPath,
  PLACEHOLDER_PNG,
} from "../lib/thumbnails.js";
import { importReposTxt, parseReposTxtText } from "../services/repos-txt.js";
import {
  coverMediaType,
  ensureSourceCover,
  type SourceCoverProject,
} from "../lib/source-cover.js";

const GITHUB_PAT_KEY = "github_pat";

const MESH_MAX_BYTES = 15 * 1024 * 1024;

type RouteDeps = {
  repo: AppRepository;
  reposDir: string;
  sourcesDir: string;
  thumbsDir: string;
  coversDir: string;
};

function toCoverProject(row: NonNullable<ReturnType<AppRepository["getProjectRow"]>>): SourceCoverProject {
  return {
    id: row.id,
    url: row.url,
    sourceKind: row.sourceKind,
    sourceType: row.sourceType,
    localPath: row.localPath,
    lastSyncedAt: row.lastSyncedAt,
    metadataJson: row.metadataJson,
  };
}

async function prefetchSourceCover(deps: RouteDeps, sourceId: number): Promise<void> {
  const row = deps.repo.getProjectRow(sourceId);
  if (!row) return;
  try {
    await ensureSourceCover(deps.coversDir, toCoverProject(row));
  } catch {
    /* cover is best-effort */
  }
}

export async function registerSourceRoutes(app: FastifyInstance, deps: RouteDeps): Promise<void> {
  app.get("/sources", async () => ({ sources: deps.repo.listSources() }));

  app.get("/sources/github-branches", async (request, reply) => {
    const url = (request.query as { url?: string }).url ?? "";
    if (!url.trim()) {
      return reply.status(400).send({ detail: "url query parameter is required" });
    }
    try {
      const token = deps.repo.getSetting(GITHUB_PAT_KEY);
      return await listGithubBranches(url, token);
    } catch (e) {
      return reply.status(400).send({ detail: e instanceof Error ? e.message : String(e) });
    }
  });

  app.get("/sources/:id", async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    const source = deps.repo.getSource(id);
    if (!source) return reply.status(404).send({ detail: "Source not found" });
    return source;
  });

  app.post("/sources", async (request, reply) => {
    try {
      const body = request.body as Record<string, unknown>;
      const sourceKind = body.source_kind != null ? String(body.source_kind) : undefined;
      const url = body.url != null ? String(body.url) : undefined;
      if (sourceKind === "printables" || sourceKind === "makerworld") {
        const { resolveRemoteSourceMetadata } = await import("../services/source-adapters.js");
        const stub = resolveRemoteSourceMetadata(sourceKind, url ?? "");
        return reply.status(501).send(stub);
      }
      return deps.repo.createSource({
        name: String(body.name ?? ""),
        url: body.url != null ? String(body.url) : undefined,
        branch: body.branch != null ? String(body.branch) : undefined,
        source_kind: body.source_kind != null ? String(body.source_kind) : undefined,
        role: body.role != null ? String(body.role) : undefined,
        local_path: body.local_path != null ? String(body.local_path) : undefined,
        metadata:
          body.metadata && typeof body.metadata === "object"
            ? (body.metadata as Record<string, unknown>)
            : undefined,
      });
    } catch (e) {
      return reply.status(400).send({ detail: e instanceof Error ? e.message : String(e) });
    }
  });

  app.patch("/sources/:id", async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    const body = request.body as Record<string, unknown>;
    try {
      return deps.repo.updateSource(id, {
        name: body.name != null ? String(body.name) : undefined,
        url: body.url != null ? String(body.url) : undefined,
        branch: body.branch != null ? String(body.branch) : undefined,
        source_kind: body.source_kind != null ? String(body.source_kind) : undefined,
        role: body.role != null ? String(body.role) : undefined,
        local_path: body.local_path != null ? String(body.local_path) : undefined,
        metadata:
          body.metadata && typeof body.metadata === "object"
            ? (body.metadata as Record<string, unknown>)
            : undefined,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return reply.status(msg.includes("not found") ? 404 : 400).send({ detail: msg });
    }
  });

  app.delete("/sources/:id", async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    if (!deps.repo.getSource(id)) return reply.status(404).send({ detail: "Source not found" });
    deps.repo.deleteSource(id);
    return reply.status(204).send();
  });

  app.get("/sources/:id/import-rules", async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    const row = deps.repo.getProjectRow(id);
    if (!row) return reply.status(404).send({ detail: "Source not found" });
    const { parseImportRulesJson } = await import("@print-partner/domain");
    const rules = parseImportRulesJson(row.importedPaths);
    return {
      rules: rules ?? [],
      legacy_import_all: rules === null,
    };
  });

  app.put("/sources/:id/import-rules", async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    const body = request.body as { rules?: string[] };
    try {
      const result = deps.repo.updateImportRules(id, body.rules ?? []);
      request.log.info(
        { sourceId: id, ruleCount: result.rules.length },
        "import-rules saved",
      );
      return result;
    } catch (e) {
      return reply.status(404).send({ detail: e instanceof Error ? e.message : String(e) });
    }
  });

  app.post("/sources/:id/upload-zip", async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    const row = deps.repo.getProjectRow(id);
    if (!row) return reply.status(404).send({ detail: "Source not found" });
    const data = await request.file();
    if (!data) return reply.status(400).send({ detail: "ZIP file required" });
    const chunks: Buffer[] = [];
    for await (const chunk of data.file) {
      chunks.push(Buffer.from(chunk));
    }
    const buffer = Buffer.concat(chunks);
    const extractDir = writeUploadedZip(buffer, deps.sourcesDir, id);
    const updated = deps.repo.updateSource(id, {
      localPath: extractDir,
      source_kind: "archive",
      last_synced_at: new Date().toISOString(),
      last_commit_sha: null,
    });
    void prefetchSourceCover(deps, id);
    return { ...updated, imported_files: buffer.length };
  });

  /** Tauri desktop: import a ZIP from a local filesystem path (same machine as the engine). */
  app.post("/sources/:id/import-archive", async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    const row = deps.repo.getProjectRow(id);
    if (!row) return reply.status(404).send({ detail: "Source not found" });
    const body = request.body as { path?: string };
    const userPath = String(body.path ?? "").trim();
    if (!userPath) return reply.status(400).send({ detail: "path is required" });
    const abs = resolve(userPath);
    try {
      if (!statSync(abs).isFile()) {
        return reply.status(400).send({ detail: "File not found" });
      }
    } catch {
      return reply.status(400).send({ detail: "File not found" });
    }
    const buffer = readFileSync(abs);
    const extractDir = writeUploadedZip(buffer, deps.sourcesDir, id);
    const updated = deps.repo.updateSource(id, {
      localPath: extractDir,
      source_kind: "archive",
      last_synced_at: new Date().toISOString(),
      last_commit_sha: null,
    });
    void prefetchSourceCover(deps, id);
    return { ...updated, imported_files: buffer.length };
  });

  app.get("/sources/:id/has-manifest", async () => ({
    has_manifest: false,
    manifest_kind: null,
  }));

  app.get("/sources/:id/cover", async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    const row = deps.repo.getProjectRow(id);
    if (!row) return reply.status(404).send({ detail: "Source not found" });
    const cached = await ensureSourceCover(deps.coversDir, toCoverProject(row));
    if (!cached) return reply.status(404).send({ detail: "No cover image for source" });
    try {
      if (!statSync(cached).isFile()) {
        return reply.status(404).send({ detail: "No cover image for source" });
      }
    } catch {
      return reply.status(404).send({ detail: "No cover image for source" });
    }
    return reply.header("Content-Type", coverMediaType(cached)).send(createReadStream(cached));
  });

  app.get("/sources/stl-search", async (request) => {
    const query = request.query as { q?: string; limit?: string };
    const limit = query.limit ? Number(query.limit) : DEFAULT_STL_SEARCH_LIMIT;
    const sources = deps.repo.listSources().map((s) => {
      const row = deps.repo.getProjectRow(s.id);
      return {
        id: s.id,
        name: s.name,
        localPath: row?.localPath ?? s.local_path,
        category: s.category,
      };
    });
    return searchSourceStls(sources, query.q ?? "", limit);
  });

  app.get("/sources/maintenance", async () => ({
    no_manifest: [],
    catalog_orphans: [],
    empty_categories: [],
    drift: [],
  }));

  app.post("/sources/import-repos-txt", async (request, reply) => {
    const body = request.body as { text?: string; path?: string };
    let text = (body.text ?? "").trim();
    if (body.path?.trim()) {
      const filePath = resolve(body.path.trim());
      try {
        if (!statSync(filePath).isFile()) {
          return reply.status(400).send({ detail: "File not found" });
        }
        text = readFileSync(filePath, "utf8");
      } catch {
        return reply.status(400).send({ detail: "File not found" });
      }
    }
    if (!text.trim()) {
      return reply.status(400).send({ detail: "Provide text or a valid path" });
    }
    if (!parseReposTxtText(text).length) {
      return reply.status(400).send({ detail: "No valid repository lines found" });
    }
    try {
      return importReposTxt(deps.repo, text);
    } catch (e) {
      return reply.status(400).send({ detail: e instanceof Error ? e.message : String(e) });
    }
  });

  app.get("/sources/:id/stl-tree", async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    const row = deps.repo.getProjectRow(id);
    if (!row) return reply.status(404).send({ detail: "Source not found" });
    if (!row.localPath) {
      return reply.status(400).send({ detail: "Source has no local_path — sync first" });
    }
    const payload = buildStlTreePayload(row.localPath, row.importedPaths);
    return { project_id: id, ...payload };
  });

  app.get("/sources/:id/stl/*", async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    const relEncoded = (request.params as { "*": string })["*"] ?? "";
    const segments = relEncoded.split("/").filter(Boolean);
    if (segments.length < 2) {
      return reply.status(404).send({ detail: "Expected …/mesh or …/preview" });
    }
    const action = segments.pop()!;
    const relativePath = decodeURIComponent(segments.join("/"));
    if (action !== "mesh" && action !== "preview") {
      return reply.status(404).send({ detail: "Unknown STL action" });
    }
    const row = deps.repo.getProjectRow(id);
    if (!row?.localPath) return reply.status(404).send({ detail: "Source not found" });
    const stl = safeRepoPath(row.localPath, relativePath);
    if (!stl) {
      const insensitive = resolveCaseInsensitiveRepoPath(row.localPath, relativePath);
      if (!insensitive) return reply.status(404).send({ detail: "STL not found" });
      return serveSourceStl(deps, reply, insensitive, action);
    }
    try {
      if (!statSync(stl).isFile()) {
        const insensitive = resolveCaseInsensitiveRepoPath(row.localPath, relativePath);
        if (!insensitive) return reply.status(404).send({ detail: "STL not found" });
        return serveSourceStl(deps, reply, insensitive, action);
      }
    } catch {
      const insensitive = resolveCaseInsensitiveRepoPath(row.localPath, relativePath);
      if (!insensitive) return reply.status(404).send({ detail: "STL not found" });
      return serveSourceStl(deps, reply, insensitive, action);
    }
    return serveSourceStl(deps, reply, stl, action);
  });
}

function serveSourceStl(
  deps: RouteDeps,
  reply: import("fastify").FastifyReply,
  stl: string,
  action: string,
) {
  if (action === "mesh") {
    try {
      if (statSync(stl).size > MESH_MAX_BYTES) {
        return reply.status(413).send({
          detail: `STL exceeds ${MESH_MAX_BYTES / (1024 * 1024)}MB mesh limit`,
        });
      }
    } catch {
      return reply.status(404).send({ detail: "STL not readable" });
    }
    return reply
      .header("Content-Type", "model/stl")
      .header("Content-Disposition", `inline; filename="${basename(stl)}"`)
      .send(createReadStream(stl));
  }
  const cached = cachedPngIfExists(globalPreviewPath(deps.thumbsDir, stl, "primary", null));
  if (cached) {
    return reply.header("Content-Type", "image/png").send(createReadStream(cached));
  }
  const thumb = cachedPngIfExists(globalThumbnailPath(deps.thumbsDir, stl, "primary", null));
  if (thumb) {
    return reply.header("Content-Type", "image/png").send(createReadStream(thumb));
  }
  return reply.header("Content-Type", "image/png").send(PLACEHOLDER_PNG);
}

export async function syncProjectById(
  repo: AppRepository,
  reposDir: string,
  projectId: number,
  coversDir = join(dirname(reposDir), "covers"),
): Promise<{ stl_count: number; downloaded: number }> {
  const row = repo.getProjectRow(projectId);
  if (!row) throw new Error("Source not found");
  const localPath = row.localPath ?? `${reposDir}/${projectId}`;
  const token = repo.getSetting(GITHUB_PAT_KEY);

  if (row.sourceKind === "github" || row.sourceType === "git") {
    const result = await syncGithubSource(row.url, row.branch ?? "main", localPath, token, {
      download: true,
      maxDownloads: 500,
    });
    repo.updateSource(projectId, {
      localPath: localPath,
      last_synced_at: new Date().toISOString(),
      last_commit_sha: result.commitSha,
    });
    repo.markSourceSynced(projectId, result.commitSha);
    const syncedRow = repo.getProjectRow(projectId);
    if (syncedRow) {
      try {
        await ensureSourceCover(coversDir, toCoverProject(syncedRow));
      } catch {
        /* cover is best-effort */
      }
    }
    return { stl_count: result.stlPaths.length, downloaded: result.downloaded };
  }

  repo.markSourceSynced(projectId, row.lastCommitSha);
  return { stl_count: 0, downloaded: 0 };
}
