import { createReadStream, mkdirSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, dirname } from "node:path";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { AppRepository } from "../db/repository.js";
import { resolvePartStl } from "../services/part-paths.js";
import { resolvePartFilamentHex } from "../services/filament-catalog.js";
import {
  cachedPngIfExists,
  globalPreviewPath,
  globalThumbnailPath,
  PLACEHOLDER_PNG,
  thumbnailCacheDigest,
} from "../lib/thumbnails.js";
import { safePathUnderRoot } from "../lib/secure-path.js";

const MESH_MAX_BYTES = 15 * 1024 * 1024;

type RouteDeps = {
  repo: AppRepository;
  thumbsDir: string;
};

async function sendPartImage(
  deps: RouteDeps,
  request: FastifyRequest,
  reply: FastifyReply,
  preview: boolean,
) {
  const id = Number((request.params as { id: string }).id);
  const part = deps.repo.getPartRow(id);
  if (!part) return reply.status(404).send({ detail: "Part not found" });
  const stl = resolvePartStl(deps.repo, part);
  if (!stl) return reply.status(404).send({ detail: "STL not found for part" });
  const hex = resolvePartFilamentHex(part);
  const role = part.role || "primary";
  const path = preview
    ? globalPreviewPath(deps.thumbsDir, stl, role, hex)
    : globalThumbnailPath(deps.thumbsDir, stl, role, hex);
  const cached = cachedPngIfExists(path);
  if (cached) {
    return reply.header("Content-Type", "image/png").send(createReadStream(cached));
  }
  return reply.header("Content-Type", "image/png").send(PLACEHOLDER_PNG);
}

export async function registerPartRoutes(app: FastifyInstance, deps: RouteDeps): Promise<void> {
  app.patch("/parts/:id", async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    const body = request.body as {
      included?: boolean;
      filament_color_id?: string | null;
      quantity_override?: number;
      spoolman_spool_id?: string | null;
    };
    if (
      body.included === undefined &&
      body.filament_color_id === undefined &&
      body.quantity_override === undefined &&
      body.spoolman_spool_id === undefined
    ) {
      return reply.status(400).send({ detail: "No fields to update" });
    }
    try {
      return deps.repo.patchPart(id, body);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return reply.status(msg.includes("not found") ? 404 : 400).send({ detail: msg });
    }
  });

  app.patch("/parts/:id/progress", async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    const body = request.body as { unit_index?: number; completed?: boolean };
    if (body.unit_index == null || body.completed == null) {
      return reply.status(400).send({ detail: "unit_index and completed required" });
    }
    try {
      return deps.repo.patchPartProgress(id, body.unit_index, body.completed);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const code = msg.includes("out of range") ? 400 : msg.includes("not found") ? 404 : 400;
      return reply.status(code).send({ detail: msg });
    }
  });

  app.get("/parts/:id/mesh", async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    const part = deps.repo.getPartRow(id);
    if (!part) return reply.status(404).send({ detail: "Part not found" });
    const stl = resolvePartStl(deps.repo, part);
    if (!stl) return reply.status(404).send({ detail: "STL not found for part" });
    try {
      const size = statSync(stl).size;
      if (size > MESH_MAX_BYTES) {
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
  });

  app.get("/parts/:id/thumbnail", async (request, reply) => sendPartImage(deps, request, reply, false));
  app.get("/parts/:id/preview", async (request, reply) => sendPartImage(deps, request, reply, true));

  // Clear cached thumbnail/preview PNGs for every part in a plan so the next
  // render regenerates them from the current filament colors. Used by the
  // "Regenerate thumbnails" action when colors look stale.
  app.post("/plans/:id/regenerate-thumbnails", async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    if (!deps.repo.getProfile(id)) {
      return reply.status(404).send({ detail: "Profile not found" });
    }
    let cleared = 0;
    for (const part of deps.repo.getProfilePartRows(id)) {
      const stl = resolvePartStl(deps.repo, part);
      if (!stl) continue;
      const hex = resolvePartFilamentHex(part);
      const role = part.role || "primary";
      const paths = [
        globalThumbnailPath(deps.thumbsDir, stl, role, hex),
        globalPreviewPath(deps.thumbsDir, stl, role, hex),
      ];
      for (const path of paths) {
        if (!cachedPngIfExists(path)) continue;
        try {
          unlinkSync(path);
          cleared += 1;
        } catch {
          /* ignore */
        }
      }
    }
    return { cleared };
  });

  app.post("/parts/:id/thumbnail", async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    const part = deps.repo.getPartRow(id);
    if (!part) return reply.status(404).send({ detail: "Part not found" });
    const stl = resolvePartStl(deps.repo, part);
    if (!stl) return reply.status(404).send({ detail: "STL not found for part" });
    const file = await request.file();
    if (!file) return reply.status(400).send({ detail: "PNG file required" });
    const buf = await file.toBuffer();
    if (buf.length < 8 || buf[0] !== 0x89) {
      return reply.status(400).send({ detail: "Expected PNG image" });
    }
    const hex = resolvePartFilamentHex(part);
    const role = part.role || "primary";
    const digest = thumbnailCacheDigest(stl, role, hex);
    if (!/^[a-f0-9]{16}$/.test(digest)) {
      return reply.status(400).send({ detail: "Invalid thumbnail digest" });
    }
    const outPath = safePathUnderRoot(deps.thumbsDir, `${digest}.png`);
    if (!outPath) return reply.status(400).send({ detail: "Invalid thumbnail path" });
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, buf);
    return { saved: true, digest };
  });
}
