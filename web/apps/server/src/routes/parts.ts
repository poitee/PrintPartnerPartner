import { basename } from "node:path";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { AppRepository } from "../db/repository.js";
import type { AcceptedOperationalPart } from "../db/accepted-plan-operational.js";
import { getColorById } from "../services/filament-catalog.js";
import { PLACEHOLDER_PNG } from "../lib/thumbnails.js";
import { AcceptedPlanOperationalIntegrityError } from "../db/accepted-plan-operational.js";
import { toAcceptedPartAssembledView } from "../services/accepted-plan-views.js";
import { openVerifiedAcceptedArtifact } from "../services/accepted-artifacts.js";
import {
  ACCEPTED_MEDIA_PNG_MAX_BYTES,
  acceptedMediaBasis,
  readAcceptedMediaPng,
  removeAcceptedMediaPng,
  writeAcceptedMediaPng,
} from "../lib/accepted-media-cache.js";

const MESH_MAX_BYTES = 15 * 1024 * 1024;

type RouteDeps = {
  repo: AppRepository;
  reposDir: string;
  thumbsDir: string;
};

type AcceptedPartRequest =
  | {
      readonly kind: "ready";
      readonly profileId: number;
      readonly part: AcceptedOperationalPart;
    }
  | { readonly kind: "part_not_found" }
  | {
      readonly kind: "accepted_state_unavailable";
      readonly reason: "compatibility_dirty" | "uninitialized";
    };

function readAcceptedPartRequest(deps: RouteDeps, partId: number): AcceptedPartRequest {
  const projection = deps.repo.getPartRow(partId);
  if (!projection) return { kind: "part_not_found" };
  const accepted = deps.repo.readAcceptedPlanOperationalSnapshot(projection.profileId);
  if (accepted.kind === "empty") return { kind: "part_not_found" };
  if (accepted.kind !== "ready") {
    return { kind: "accepted_state_unavailable", reason: accepted.kind };
  }
  const part = accepted.snapshot.parts.find((candidate) => candidate.projectionPartId === partId);
  return part
    ? { kind: "ready", profileId: projection.profileId, part }
    : { kind: "part_not_found" };
}

function acceptedRenderHex(part: AcceptedOperationalPart): string | null {
  const custom = part.filamentCustomHex?.trim() ?? "";
  if (/^#[0-9a-f]{6}$/i.test(custom)) return custom.toLowerCase();
  const catalog = part.filamentColorId ? getColorById(part.filamentColorId) : null;
  const catalogHex = catalog?.hex.trim() ?? "";
  return /^#[0-9a-f]{6}$/i.test(catalogHex) ? catalogHex.toLowerCase() : null;
}

function acceptedStateDetail(reason: "compatibility_dirty" | "uninitialized"): string {
  return reason === "compatibility_dirty"
    ? "Accepted Plan requires compatibility repair"
    : "Accepted Plan operational state is not initialized";
}

function matchesStrongEtagList(value: string | string[] | undefined, etag: string): boolean {
  if (typeof value !== "string") return false;
  return value.split(",").some((candidate) => candidate.trim() === etag);
}

async function sendPartImage(
  deps: RouteDeps,
  request: FastifyRequest,
  reply: FastifyReply,
  preview: boolean,
) {
  const id = Number((request.params as { id: string }).id);
  let profileId: number | null = null;
  try {
    const accepted = readAcceptedPartRequest(deps, id);
    if (accepted.kind === "part_not_found") {
      return reply.status(404).send({ detail: "Part not found" });
    }
    if (accepted.kind === "accepted_state_unavailable") {
      return reply.status(409).send({ detail: acceptedStateDetail(accepted.reason) });
    }
    profileId = accepted.profileId;
    const part = accepted.part;
    if (part.artifact.kind === "unavailable") {
      return reply.status(409).send({ detail: "Accepted Part media is unavailable" });
    }
    const verified = openVerifiedAcceptedArtifact({
      reposDir: deps.reposDir,
      artifact: part.artifact,
      maxBytes: MESH_MAX_BYTES,
    });
    if (verified.kind !== "verified") {
      if (verified.kind === "unavailable") {
        return reply.status(409).send({ detail: "Accepted Part media is unavailable" });
      }
      return reply.status(409).send({ detail: "Accepted Part artifact is unavailable" });
    }
    verified.lease.close();
    const hex = acceptedRenderHex(part);
    const basis = acceptedMediaBasis({
      expectedSha256: part.artifact.expectedSha256,
      role: part.effectiveRole,
      hex,
      variant: preview ? "preview" : "thumbnail",
    });
    const cached = readAcceptedMediaPng({ thumbsDir: deps.thumbsDir, basis });
    if (!cached) {
      reply.header("Content-Type", "image/png").header("Cache-Control", "no-store");
      if (hex) reply.header("X-Accepted-Render-Hex", hex);
      return reply.send(PLACEHOLDER_PNG);
    }
    const etag = `"${basis}"`;
    if (matchesStrongEtagList(request.headers["if-none-match"], etag)) {
      reply.status(304).header("Cache-Control", "private, no-cache").header("ETag", etag);
      if (hex) reply.header("X-Accepted-Render-Hex", hex);
      return reply.send();
    }
    reply
      .header("Content-Type", "image/png")
      .header("Cache-Control", "private, no-cache")
      .header("ETag", etag);
    if (hex) reply.header("X-Accepted-Render-Hex", hex);
    return reply.send(cached);
  } catch (error) {
    if (error instanceof AcceptedPlanOperationalIntegrityError) {
      request.log.error(
        { code: error.code, profileId, partId: id },
        "Accepted Plan integrity failure",
      );
      return reply.status(500).send({ detail: "Accepted Plan data is inconsistent" });
    }
    request.log.error(
      { failure: "unexpected", profileId, partId: id },
      "Accepted Part media failed",
    );
    return reply.status(500).send({ detail: "Internal Server Error" });
  }
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

  app.get("/parts/:id/assembled", async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    let profileId: number | null = null;
    try {
      const part = deps.repo.getPartRow(id);
      if (!part) return reply.status(404).send({ detail: "Part not found" });
      profileId = part.profileId;
      const accepted = deps.repo.readAcceptedPlanOperationalSnapshot(profileId);
      const view = toAcceptedPartAssembledView({ partId: id, accepted });
      if (view.kind === "part_not_found") {
        return reply.status(404).send({ detail: "Part not found" });
      }
      if (view.kind === "accepted_state_unavailable") {
        const detail =
          view.reason === "compatibility_dirty"
            ? "Accepted Plan requires compatibility repair"
            : "Accepted Plan operational state is not initialized";
        return reply.status(409).send({ detail });
      }
      return view.body;
    } catch (error) {
      if (error instanceof AcceptedPlanOperationalIntegrityError) {
        request.log.error(
          { code: error.code, profileId, partId: id },
          "Accepted Plan integrity failure",
        );
        return reply.status(500).send({ detail: "Accepted Plan data is inconsistent" });
      }
      request.log.error(
        { err: error, profileId, partId: id },
        "Accepted Plan read failed",
      );
      return reply.status(500).send({ detail: "Internal Server Error" });
    }
  });

  app.patch("/parts/:id/assembled", async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    const body = request.body as { unit_index?: number; assembled?: boolean };
    if (body.unit_index == null || body.assembled == null) {
      return reply.status(400).send({ detail: "unit_index and assembled required" });
    }
    if (typeof body.assembled !== "boolean" || !Number.isInteger(body.unit_index)) {
      return reply.status(400).send({ detail: "unit_index must be an integer and assembled a boolean" });
    }
    try {
      return deps.repo.patchPartAssembled(id, body.unit_index, body.assembled);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const code = msg.includes("out of range") ? 400 : msg.includes("not found") ? 404 : 400;
      return reply.status(code).send({ detail: msg });
    }
  });

  app.get("/parts/:id/mesh", async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    let profileId: number | null = null;
    try {
      const accepted = readAcceptedPartRequest(deps, id);
      if (accepted.kind === "part_not_found") {
        return reply.status(404).send({ detail: "Part not found" });
      }
      if (accepted.kind === "accepted_state_unavailable") {
        return reply.status(409).send({ detail: acceptedStateDetail(accepted.reason) });
      }
      const part = accepted.part;
      profileId = accepted.profileId;
      if (part.artifact.kind === "unavailable") {
        return reply.status(409).send({ detail: "Accepted Part media is unavailable" });
      }
      const hex = acceptedRenderHex(part);
      const basis = acceptedMediaBasis({
        expectedSha256: part.artifact.expectedSha256,
        role: part.effectiveRole,
        hex,
        variant: "mesh",
      });
      const opened = openVerifiedAcceptedArtifact({
        reposDir: deps.reposDir,
        artifact: part.artifact,
        maxBytes: MESH_MAX_BYTES,
      });
      if (opened.kind !== "verified") {
        if (opened.kind === "unavailable") {
          return reply.status(409).send({ detail: "Accepted Part media is unavailable" });
        }
        if (opened.reason === "too_large") {
          return reply.status(413).send({
            detail: `STL exceeds ${MESH_MAX_BYTES / (1024 * 1024)}MB mesh limit`,
          });
        }
        return reply.status(409).send({ detail: "Accepted Part artifact is unavailable" });
      }
      const etag = `"${basis}"`;
      if (matchesStrongEtagList(request.headers["if-none-match"], etag)) {
        opened.lease.close();
        reply.status(304).header("Cache-Control", "private, no-cache").header("ETag", etag);
        if (hex) reply.header("X-Accepted-Render-Hex", hex);
        return reply.send();
      }
      const stream = opened.lease.createReadStream();
      const closeLease = () => opened.lease.close();
      stream.once("end", closeLease);
      stream.once("error", closeLease);
      stream.once("close", closeLease);
      const filename = basename(part.filename).replace(/["\r\n]/g, "_");
      reply
        .header("Content-Type", "model/stl")
        .header("Content-Disposition", `inline; filename="${filename}"`)
        .header("Content-Length", opened.lease.size)
        .header("Cache-Control", "private, no-cache")
        .header("ETag", etag);
      if (hex) reply.header("X-Accepted-Render-Hex", hex);
      return reply.send(stream);
    } catch (error) {
      if (error instanceof AcceptedPlanOperationalIntegrityError) {
        request.log.error(
          { code: error.code, profileId, partId: id },
          "Accepted Plan integrity failure",
        );
        return reply.status(500).send({ detail: "Accepted Plan data is inconsistent" });
      }
      request.log.error(
        { failure: "unexpected", profileId, partId: id },
        "Accepted Part media failed",
      );
      return reply.status(500).send({ detail: "Internal Server Error" });
    }
  });

  app.get("/parts/:id/thumbnail", async (request, reply) => sendPartImage(deps, request, reply, false));
  app.get("/parts/:id/preview", async (request, reply) => sendPartImage(deps, request, reply, true));

  app.post("/plans/:id/regenerate-thumbnails", async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    try {
      if (!deps.repo.getProfile(id)) {
        return reply.status(404).send({ detail: "Profile not found" });
      }
      const accepted = deps.repo.readAcceptedPlanOperationalSnapshot(id);
      if (accepted.kind === "empty") return { cleared: 0 };
      if (accepted.kind !== "ready") {
        return reply.status(409).send({ detail: acceptedStateDetail(accepted.kind) });
      }
      let cleared = 0;
      for (const part of accepted.snapshot.parts) {
        if (part.artifact.kind !== "tracked") continue;
        const hex = acceptedRenderHex(part);
        for (const variant of ["thumbnail", "preview"] as const) {
          const basis = acceptedMediaBasis({
            expectedSha256: part.artifact.expectedSha256,
            role: part.effectiveRole,
            hex,
            variant,
          });
          if (removeAcceptedMediaPng({ thumbsDir: deps.thumbsDir, basis })) cleared += 1;
        }
      }
      return { cleared };
    } catch (error) {
      if (error instanceof AcceptedPlanOperationalIntegrityError) {
        request.log.error({ code: error.code, profileId: id }, "Accepted Plan integrity failure");
        return reply.status(500).send({ detail: "Accepted Plan data is inconsistent" });
      }
      request.log.error(
        { failure: "unexpected", profileId: id },
        "Accepted thumbnail regeneration failed",
      );
      return reply.status(500).send({ detail: "Internal Server Error" });
    }
  });

  app.post("/parts/:id/thumbnail", async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    let profileId: number | null = null;
    try {
      const projection = deps.repo.getPartRow(id);
      if (!projection) {
        return reply.status(404).send({ detail: "Part not found" });
      }
      profileId = projection.profileId;
      const ifMatch = request.headers["if-match"];
      if (typeof ifMatch !== "string" || !/^"[0-9a-f]{64}"$/.test(ifMatch)) {
        return reply.status(400).send({ detail: "Strong If-Match header required" });
      }
      const file = await request.file({ limits: { fileSize: ACCEPTED_MEDIA_PNG_MAX_BYTES } });
      if (!file) return reply.status(400).send({ detail: "PNG file required" });
      const buf = await file.toBuffer();
      if (file.file.truncated || buf.length > ACCEPTED_MEDIA_PNG_MAX_BYTES) {
        return reply.status(413).send({ detail: "PNG exceeds 5MB thumbnail limit" });
      }

      const accepted = deps.repo.readAcceptedPlanOperationalSnapshot(profileId);
      if (accepted.kind === "empty") {
        return reply.status(404).send({ detail: "Part not found" });
      }
      if (accepted.kind !== "ready") {
        return reply.status(409).send({ detail: acceptedStateDetail(accepted.kind) });
      }
      const part = accepted.snapshot.parts.find(
        (candidate) => candidate.projectionPartId === id,
      );
      if (!part) {
        return reply.status(409).send({ detail: "Accepted Part media basis is stale" });
      }
      if (part.artifact.kind === "unavailable") {
        return reply.status(409).send({ detail: "Accepted Part media is unavailable" });
      }
      const hex = acceptedRenderHex(part);
      const meshBasis = acceptedMediaBasis({
        expectedSha256: part.artifact.expectedSha256,
        role: part.effectiveRole,
        hex,
        variant: "mesh",
      });
      if (ifMatch !== `"${meshBasis}"`) {
        return reply.status(409).send({ detail: "Accepted Part media basis is stale" });
      }
      const verified = openVerifiedAcceptedArtifact({
        reposDir: deps.reposDir,
        artifact: part.artifact,
        maxBytes: MESH_MAX_BYTES,
      });
      if (verified.kind !== "verified") {
        return reply.status(409).send({ detail: "Accepted Part artifact is unavailable" });
      }
      verified.lease.close();
      const thumbnailBasis = acceptedMediaBasis({
        expectedSha256: part.artifact.expectedSha256,
        role: part.effectiveRole,
        hex,
        variant: "thumbnail",
      });
      try {
        writeAcceptedMediaPng({ thumbsDir: deps.thumbsDir, basis: thumbnailBasis, png: buf });
      } catch (error) {
        const message = error instanceof Error ? error.message : "";
        if (message.includes("size limit")) {
          return reply.status(413).send({ detail: "PNG exceeds 5MB thumbnail limit" });
        }
        if (message.includes("Invalid accepted media PNG")) {
          return reply.status(400).send({ detail: "Expected PNG image" });
        }
        throw error;
      }
      return { saved: true, digest: thumbnailBasis };
    } catch (error) {
      if (
        error instanceof Error &&
        "code" in error &&
        error.code === "FST_REQ_FILE_TOO_LARGE"
      ) {
        return reply.status(413).send({ detail: "PNG exceeds 5MB thumbnail limit" });
      }
      if (error instanceof AcceptedPlanOperationalIntegrityError) {
        request.log.error(
          { code: error.code, profileId, partId: id },
          "Accepted Plan integrity failure",
        );
        return reply.status(500).send({ detail: "Accepted Plan data is inconsistent" });
      }
      request.log.error(
        { failure: "unexpected", profileId, partId: id },
        "Accepted Part media failed",
      );
      return reply.status(500).send({ detail: "Internal Server Error" });
    }
  });
}
