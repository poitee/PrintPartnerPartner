import type { FastifyInstance } from "fastify";
import { existsSync, accessSync, constants } from "node:fs";
import type { AcceptedPlateSlicerHandoffResult } from "@print-partner/contracts";
import type { AppRepository } from "../db/repository.js";
import type { ServerConfig } from "../config.js";
import { runExport3mfJob } from "../services/export-3mf-job.js";
import { localAppOpenHint, stagePlatesToExchange } from "../services/slicer-handoff.js";
import { loadFleet } from "../services/printer-fleet.js";
import { validateSlicerGuiUrl } from "../services/slicer-instances.js";
import { exportDownloadKey, tenantExportDirectory } from "../lib/secure-path.js";
import {
  ACCEPTED_PLATE_EXPORT_LIMITS,
  materializeAcceptedPlateExport,
  stageAcceptedPlateExport,
  type MaterializeAcceptedPlateExportResult,
} from "../services/accepted-plate-export-delivery.js";

type RouteDeps = {
  repo: AppRepository;
  config: ServerConfig;
  exportsDir: string;
  dataDir: string;
  reposDir: string;
};

function positiveSafeInteger(value: unknown): number | null {
  return Number.isSafeInteger(value) && Number(value) > 0 ? Number(value) : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function acceptedHandoffFailure(
  result: Exclude<MaterializeAcceptedPlateExportResult, { readonly kind: "materialized" }>,
): Readonly<{ status: number; detail: string }> {
  switch (result.kind) {
    case "plate_revision_changed":
      return { status: 409, detail: "Plate layout changed. Refresh and try again." };
    case "output_conflict":
      return { status: 409, detail: "The stored export for this Plate revision failed integrity verification." };
    case "transaction_unavailable":
      return { status: 503, detail: "Accepted Plate export is temporarily unavailable." };
    case "artifact_unavailable":
    case "invalid_stl":
    case "artifact_geometry_mismatch":
      return { status: 422, detail: "A verified accepted artifact is unavailable." };
    case "limit_exceeded":
      return { status: 422, detail: "Accepted Plate export exceeds the configured limit." };
    case "profile_not_found":
    case "empty_plan":
    case "plates_not_published":
    case "stale_accepted_plan":
    case "accepted_state_unavailable":
      return { status: 409, detail: "Accepted Plan state is unavailable. Refresh the Plan." };
  }
}

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
    const exportsDir = tenantExportDirectory(deps.exportsDir, request.tenantId ?? "default");

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

  app.post("/slicer-instances/:id/open-accepted-plates", async (request, reply) => {
    if (!isRecord(request.body)) {
      return reply.status(400).send({ detail: "profile_id and expected_plate_revision_id are required" });
    }
    const profileId = positiveSafeInteger(request.body.profile_id);
    const expectedPlateRevisionId = positiveSafeInteger(request.body.expected_plate_revision_id);
    if (profileId == null || expectedPlateRevisionId == null) {
      return reply.status(400).send({ detail: "profile_id and expected_plate_revision_id must be positive integers" });
    }
    if (!deps.repo.getOwnedProfileIdentity(profileId)) {
      return reply.status(404).send({ detail: "Profile not found" });
    }
    if (!isRecord(request.params) || typeof request.params.id !== "string") {
      return reply.status(400).send({ detail: "Slicer instance id is invalid" });
    }
    const id = request.params.id;
    const instance = deps.repo.getSlicerInstance(id);
    if (!instance) return reply.status(404).send({ detail: "Slicer instance not found" });
    if (!instance.enabled) return reply.status(400).send({ detail: "Slicer instance is disabled" });
    const guiErr = validateSlicerGuiUrl(instance.guiUrl);
    if (guiErr || !instance.guiUrl.trim()) {
      return reply.status(400).send({ detail: "Instance needs a valid http(s) gui_url" });
    }
    if (exchangeReady(deps.config.exchangeDir)) {
      return reply.status(400).send({
        detail: "Slicer exchange is unavailable. Use Download 3MF instead.",
      });
    }

    try {
      const materialized = await materializeAcceptedPlateExport({
        repository: deps.repo,
        reposDir: deps.reposDir,
        tenantExportsDir: tenantExportDirectory(deps.exportsDir, request.tenantId),
        limits: ACCEPTED_PLATE_EXPORT_LIMITS,
      }, { profileId, expectedPlateRevisionId });
      if (materialized.kind !== "materialized") {
        const failure = acceptedHandoffFailure(materialized);
        return reply.status(failure.status).send({ detail: failure.detail });
      }
      const staged = await stageAcceptedPlateExport({
        materialized,
        exchangeRoot: deps.config.exchangeDir,
        instanceId: instance.id,
      });
      if (staged.kind === "output_conflict") {
        return reply.status(409).send({
          detail: "The slicer inbox for this Plate revision failed integrity verification.",
        });
      }
      const primary = materialized.plates.length === 1
        ? materialized.plates[0]
        : materialized.bundle;
      if (!primary) {
        return reply.status(500).send({ detail: "Accepted Plate handoff failed." });
      }
      const downloadKey = exportDownloadKey(
        deps.dataDir,
        request.tenantId,
        primary.absolutePath,
      );
      if (!downloadKey) {
        return reply.status(500).send({ detail: "Accepted Plate handoff failed." });
      }
      const result: AcceptedPlateSlicerHandoffResult = {
        gui_url: instance.guiUrl.trim(),
        plate_revision_id: materialized.plateRevisionId,
        plate_revision_number: materialized.plateRevisionNumber,
        layout_digest: materialized.layoutDigest,
        inbox_relative_path: staged.inboxRelativePath,
        staged: staged.staged,
        download_url: `/exports/${downloadKey}`,
        local_app: {
          scheme_attempt: null,
          note: "Open the revision directory from the configured slicer exchange mount.",
        },
      };
      return result;
    } catch {
      request.log.error(
        {
          operation: "accepted_plate_slicer_handoff",
          failure: "unexpected",
          profileId,
          expectedPlateRevisionId,
          slicerInstanceId: id,
        },
        "Accepted Plate slicer handoff failed unexpectedly",
      );
      return reply.status(500).send({ detail: "Accepted Plate handoff failed." });
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
