import type { FastifyInstance } from "fastify";
import { existsSync, accessSync, constants } from "node:fs";
import type { AppRepository } from "../db/repository.js";
import type { ServerConfig } from "../config.js";
import { runExport3mfJob } from "../services/export-3mf-job.js";
import { localAppOpenHint, stagePlatesToExchange } from "../services/slicer-handoff.js";
import { loadFleet } from "../services/printer-fleet.js";
import { validateSlicerGuiUrl } from "../services/slicer-instances.js";
import { tenantExportDirectory } from "../lib/secure-path.js";

type RouteDeps = {
  repo: AppRepository;
  config: ServerConfig;
  exportsDir: string;
};

function exchangeReady(exchangeDir: string): string | null {
  if (!exchangeDir.trim()) return "PP_EXCHANGE_DIR is not configured";
  try {
    if (!existsSync(exchangeDir)) {
      return `Exchange directory missing: ${exchangeDir}`;
    }
    accessSync(exchangeDir, constants.W_OK);
  } catch {
    return `Exchange directory not writable: ${exchangeDir}`;
  }
  return null;
}

export async function registerSlicerHandoffRoutes(
  app: FastifyInstance,
  deps: RouteDeps,
): Promise<void> {
  app.post("/slicer-instances/:id/open-plates", async (request, reply) => {
    const { id } = request.params as { id: string };
    const instance = deps.repo.getSlicerInstance(id);
    if (!instance) return reply.status(404).send({ detail: "Slicer instance not found" });
    if (!instance.enabled) {
      return reply.status(400).send({ detail: "Slicer instance is disabled" });
    }
    const guiErr = validateSlicerGuiUrl(instance.guiUrl);
    if (guiErr || !instance.guiUrl.trim()) {
      return reply.status(400).send({ detail: "Instance needs a valid http(s) gui_url" });
    }

    const exchangeErr = exchangeReady(deps.config.exchangeDir);
    if (exchangeErr) {
      return reply.status(400).send({
        detail: `${exchangeErr}. Use Download 3MF instead, or mount PP_EXCHANGE_DIR.`,
      });
    }

    const body = (request.body ?? {}) as {
      profile_id?: number;
      layout_mode?: string;
      missing_only?: boolean;
      enabled_printer_ids?: string[];
    };
    const profileId = Number(body.profile_id);
    if (!Number.isFinite(profileId) || profileId <= 0) {
      return reply.status(400).send({ detail: "profile_id is required" });
    }

    const fleet = loadFleet(deps.repo);
    const enabledIds =
      body.enabled_printer_ids ??
      fleet.map((p) => p.id);
    if (!enabledIds.length) {
      return reply.status(400).send({ detail: "No printers enabled for export" });
    }
    const exportsDir = tenantExportDirectory(deps.exportsDir, request.tenantId);

    let result: ReturnType<typeof runExport3mfJob>;
    try {
      result = runExport3mfJob(deps.repo, profileId, exportsDir, {
        layout_mode: body.layout_mode ?? "per_plate",
        missing_only: body.missing_only ?? false,
        enabled_printer_ids: enabledIds,
      });
    } catch (e) {
      return reply.status(400).send({
        detail: e instanceof Error ? e.message : String(e),
      });
    }

    const paths = Array.isArray(result.paths) ? result.paths.filter((p): p is string => typeof p === "string") : [];
    if (!paths.length) {
      return reply.status(400).send({
        detail: "No 3MF plates exported",
        warnings: result.warnings ?? [],
      });
    }

    const { name } = deps.repo.buildMergePartsForProfile(profileId);
    const planSlug = name || `profile-${profileId}`;

    try {
      const { staged, inboxDir } = stagePlatesToExchange({
        exchangeRoot: deps.config.exchangeDir,
        instanceId: instance.id,
        sourcePaths: paths,
        planSlug,
        exportsRoot: exportsDir,
      });
      return {
        gui_url: instance.guiUrl.trim(),
        inbox_dir: inboxDir,
        staged: staged.map((s) => ({
          filename: s.filename,
          dest: s.dest,
        })),
        download_paths: paths,
        object_count: result.object_count ?? staged.length,
        warnings: result.warnings ?? [],
        local_app: localAppOpenHint(staged[0]?.filename ?? "plate.3mf"),
      };
    } catch (e) {
      return reply.status(400).send({
        detail: e instanceof Error ? e.message : String(e),
      });
    }
  });

  app.get("/slicer-handoff/exchange-status", async () => {
    const err = exchangeReady(deps.config.exchangeDir);
    return {
      configured: Boolean(deps.config.exchangeDir.trim()),
      exchange_dir: deps.config.exchangeDir,
      ready: !err,
      detail: err,
    };
  });
}
