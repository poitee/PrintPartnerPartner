import type { FastifyInstance } from "fastify";
import type { AppRepository } from "../db/repository.js";
import { buildPlanReview } from "../services/plan-review.js";
import { applyManifestToProfile } from "../services/manifest-apply.js";
import { loadKitManifest, saveKitManifest } from "../services/kit-manifest-store.js";
import { buildPlanManifestBuilder } from "../services/plan-manifest-builder.js";
import { preloadSpoolmanForColorIds, enrichRoleFilamentRows } from "../services/filament-resolve.js";
import { clearPlanThumbnailCache } from "../services/plan-thumbnails.js";
import { canonicalRoleOrder, loadRoleFilamentDefaults } from "../services/role-filament-store.js";

type RouteDeps = { repo: AppRepository; dataDir: string; thumbsDir: string };

export async function registerPlanRoutes(app: FastifyInstance, deps: RouteDeps): Promise<void> {
  app.get("/plans", async () => ({ profiles: deps.repo.listProfiles() }));

  app.post("/plans", async (request, reply) => {
    try {
      const body = request.body as { name?: string; base_project_id?: number };
      return deps.repo.createProfile(String(body.name ?? ""), body.base_project_id);
    } catch (e) {
      return reply.status(400).send({ detail: e instanceof Error ? e.message : String(e) });
    }
  });

  app.get("/plans/:id", async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    const profile = deps.repo.getProfile(id);
    if (!profile) return reply.status(404).send({ detail: "Profile not found" });
    return profile;
  });

  app.delete("/plans/:id", async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    if (!deps.repo.getProfile(id)) return reply.status(404).send({ detail: "Profile not found" });
    deps.repo.deleteProfile(id);
    return reply.status(204).send();
  });

  app.patch("/plans/:id", async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    const body = request.body as { name?: string };
    try {
      return deps.repo.renameProfile(id, String(body.name ?? ""));
    } catch (e) {
      return reply.status(400).send({ detail: e instanceof Error ? e.message : String(e) });
    }
  });

  app.post("/plans/:id/duplicate", async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    const body = request.body as { name?: string; clear_checkoff?: boolean };
    try {
      return deps.repo.duplicateProfile(id, String(body.name ?? ""), {
        clearCheckoff: Boolean(body.clear_checkoff),
      });
    } catch (e) {
      return reply.status(400).send({ detail: e instanceof Error ? e.message : String(e) });
    }
  });

  app.delete("/plans/:id/layers/:layerId", async (request, reply) => {
    const profileId = Number((request.params as { id: string }).id);
    const layerId = Number((request.params as { layerId: string }).layerId);
    if (!deps.repo.getProfile(profileId)) return reply.status(404).send({ detail: "Profile not found" });
    try {
      deps.repo.removeLayer(layerId);
      return reply.status(204).send();
    } catch (e) {
      return reply.status(404).send({ detail: e instanceof Error ? e.message : String(e) });
    }
  });

  app.put("/plans/:id/layers/:layerId", async (request, reply) => {
    const profileId = Number((request.params as { id: string }).id);
    const layerId = Number((request.params as { layerId: string }).layerId);
    const body = request.body as { project_id?: number };
    if (!deps.repo.getProfile(profileId)) return reply.status(404).send({ detail: "Profile not found" });
    try {
      deps.repo.replaceLayer(layerId, Number(body.project_id));
      return { profile_id: profileId, layers: deps.repo.getProfileLayers(profileId) };
    } catch (e) {
      return reply.status(404).send({ detail: e instanceof Error ? e.message : String(e) });
    }
  });

  app.get("/plans/:id/layers", async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    if (!deps.repo.getProfile(id)) return reply.status(404).send({ detail: "Profile not found" });
    return { profile_id: id, layers: deps.repo.getProfileLayers(id) };
  });

  app.put("/plans/:id/layers/base", async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    const body = request.body as { project_id?: number };
    if (!deps.repo.getProfile(id)) return reply.status(404).send({ detail: "Profile not found" });
    try {
      deps.repo.setBaseLayer(id, Number(body.project_id));
      return { profile_id: id, layers: deps.repo.getProfileLayers(id) };
    } catch (e) {
      return reply.status(404).send({ detail: e instanceof Error ? e.message : String(e) });
    }
  });

  app.post("/plans/:id/layers", async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    const body = request.body as { project_id?: number };
    if (!deps.repo.getProfile(id)) return reply.status(404).send({ detail: "Profile not found" });
    try {
      deps.repo.addAddonLayer(id, Number(body.project_id));
      return { profile_id: id, layers: deps.repo.getProfileLayers(id) };
    } catch (e) {
      return reply.status(404).send({ detail: e instanceof Error ? e.message : String(e) });
    }
  });

  app.get("/plans/:id/parts", async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    if (!deps.repo.getProfile(id)) return reply.status(404).send({ detail: "Profile not found" });
    const query = request.query as { limit?: string; offset?: string };
    const limit = query.limit ? Number(query.limit) : 10000;
    const offset = query.offset ? Number(query.offset) : 0;
    const result = deps.repo.listParts(id, limit, offset);
    return {
      profile_id: id,
      total: result.total,
      offset,
      limit,
      parts: result.parts,
    };
  });

  app.get("/plans/:id/parts-grouped", async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    if (!deps.repo.getProfile(id)) return reply.status(404).send({ detail: "Profile not found" });
    const query = (request.query as { query?: string }).query ?? "";
    return deps.repo.getPartsGrouped(id, query);
  });

  app.get("/plans/:id/review", async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    if (!deps.repo.getProfile(id)) return reply.status(404).send({ detail: "Profile not found" });
    const query = request.query as { include_excluded?: string };
    const include_excluded =
      query.include_excluded === "1" ||
      query.include_excluded === "true";
    const resolveDeps = { repo: deps.repo, dataDir: deps.dataDir };
    const { parts: reviewParts } = deps.repo.listParts(id, 10000, 0);
    const ctx = await preloadSpoolmanForColorIds(
      resolveDeps,
      reviewParts.map((p) => p.filament_color_id),
    );
    return buildPlanReview(deps.repo, id, {
      includeExcluded: include_excluded,
      filamentContext: ctx,
    });
  });

  app.post("/plans/:id/apply-manifest", async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    if (!deps.repo.getProfile(id)) return reply.status(404).send({ detail: "Profile not found" });
    const body = (request.body as { preserve_included?: boolean } | null) ?? {};
    const result = applyManifestToProfile(deps.repo, id, body.preserve_included ?? true);
    return {
      profile_id: id,
      applied_rules: result.applied_rules,
      warnings: result.warnings,
    };
  });

  app.get("/plans/maintenance", async () => ({ plans_with_warnings: [] }));
  app.get("/plans/:id/manifest-summary", async (request) => ({
    profile_id: Number((request.params as { id: string }).id),
    required: { total: 0, included: 0 },
    optional: { total: 0, included: 0 },
    recommended: { total: 0, included: 0 },
    option_groups: [],
  }));
  app.get("/plans/:id/manifest-warnings", async () => ({ warnings: [] }));
  app.get("/plans/:id/role-filaments", async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    if (!deps.repo.getProfile(id)) return reply.status(404).send({ detail: "Profile not found" });
    const roles = deps.repo.getRoleFilaments(id);
    await enrichRoleFilamentRows(roles, { repo: deps.repo, dataDir: deps.dataDir });
    return { roles };
  });

  app.put("/plans/:id/role-filament", async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    if (!deps.repo.getProfile(id)) return reply.status(404).send({ detail: "Profile not found" });
    const body = request.body as {
      role?: string;
      filament_color_id?: string | null;
      filament_custom_hex?: string | null;
      spoolman_spool_id?: string | null;
      refresh_thumbnails?: boolean;
    };
    const role = String(body.role ?? "").trim();
    if (!role) return reply.status(400).send({ detail: "role is required" });
    const spoolRef =
      body.spoolman_spool_id !== undefined ? body.spoolman_spool_id : undefined;
    const updated = deps.repo.bulkSetRoleFilament(
      id,
      role,
      body.filament_color_id ?? null,
      body.filament_custom_hex ?? null,
      spoolRef,
    );
    const refreshThumbnails = body.refresh_thumbnails !== false;
    const thumbnails_cleared =
      refreshThumbnails && updated > 0
        ? clearPlanThumbnailCache(deps.repo, deps.thumbsDir, id, { role })
        : 0;
    const roles = deps.repo.getRoleFilaments(id);
    await enrichRoleFilamentRows(roles, { repo: deps.repo, dataDir: deps.dataDir });
    return { updated, thumbnails_cleared, roles };
  });

  /** Re-apply every saved role color to matching included parts and refresh thumbnails. */
  app.post("/plans/:id/apply-role-colors", async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    if (!deps.repo.getProfile(id)) return reply.status(404).send({ detail: "Profile not found" });
    const body = (request.body ?? {}) as { refresh_thumbnails?: boolean };
    const refreshThumbnails = body.refresh_thumbnails !== false;
    const savedDefaults = loadRoleFilamentDefaults(deps.repo, id);
    let updated = 0;
    for (const role of canonicalRoleOrder()) {
      const saved = savedDefaults[role];
      if (!saved?.filament_color_id && !saved?.filament_custom_hex) continue;
      updated += deps.repo.bulkSetRoleFilament(
        id,
        role,
        saved.filament_color_id ?? null,
        saved.filament_custom_hex ?? null,
        saved.spoolman_spool_id ?? undefined,
      );
    }
    const thumbnails_cleared = refreshThumbnails
      ? clearPlanThumbnailCache(deps.repo, deps.thumbsDir, id)
      : 0;
    const roles = deps.repo.getRoleFilaments(id);
    await enrichRoleFilamentRows(roles, { repo: deps.repo, dataDir: deps.dataDir });
    return { updated, thumbnails_cleared, roles };
  });

  app.get("/plans/:id/checkoff", async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    if (!deps.repo.getProfile(id)) return reply.status(404).send({ detail: "Profile not found" });
    const resolveDeps = { repo: deps.repo, dataDir: deps.dataDir };
    const { parts: checkoffParts } = deps.repo.listParts(id, 10000, 0);
    const ctx = await preloadSpoolmanForColorIds(
      resolveDeps,
      checkoffParts.map((p) => p.filament_color_id),
    );
    return deps.repo.getCheckoff(id, ctx);
  });

  app.get("/plans/:id/kit-manifest", async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    if (!deps.repo.getProfile(id)) return reply.status(404).send({ detail: "Profile not found" });
    return { profile_id: id, kit: loadKitManifest(deps.repo, id) };
  });

  app.put("/plans/:id/kit-manifest", async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    if (!deps.repo.getProfile(id)) return reply.status(404).send({ detail: "Profile not found" });
    const body = request.body as { kit?: Record<string, unknown> };
    const kit = saveKitManifest(deps.repo, id, (body.kit ?? {}) as Parameters<typeof saveKitManifest>[2]);
    return { profile_id: id, kit };
  });

  app.get("/plans/:id/manifest-v2", async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    if (!deps.repo.getProfile(id)) return reply.status(404).send({ detail: "Profile not found" });
    const raw = deps.repo.getSetting(`manifest_v2_${id}`);
    if (!raw) {
      return {
        profile_id: id,
        version: 2,
        yaml: "format: print-partner-manifest-v2\nversion: 2\n",
        plan: { name: null, base_source_id: null, addon_source_ids: [] },
        sources: [],
        selections: {},
        option_groups: {},
        option_group_count: 0,
        addon_count: 0,
      };
    }
    try {
      return JSON.parse(raw);
    } catch {
      return reply.status(400).send({ detail: "Invalid stored manifest" });
    }
  });

  app.get("/plans/:id/plan-manifest-builder", async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    if (!deps.repo.getProfile(id)) return reply.status(404).send({ detail: "Profile not found" });
    return buildPlanManifestBuilder(deps.repo, id);
  });
}
