import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import { basename } from "node:path";
import type { FastifyInstance } from "fastify";
import type { AppRepository } from "../db/repository.js";
import type { IntegrationPort } from "../integrations/store.js";
import { getIntegrationConfig } from "../integrations/store.js";
import { sendProblem } from "../lib/api-error.js";
import { parseCheckoffUnits } from "../services/printer-checkoff.js";
import { loadFleet } from "../services/printer-fleet.js";
import {
  cancelPrinterSendQueueItem,
  enqueuePrinterSend,
  listActivePrinterSendQueue,
  loadPrinterSendQueue,
} from "../services/printer-send-queue-store.js";
import {
  dispatchPrinterSendQueueItem,
  drainPrinterSendQueue,
} from "../services/printer-send-queue.js";
import {
  isAllowedPrinterUploadFilename,
  streamPrinterUploadArtifact,
} from "../services/printer-upload-job.js";
import type { InProcessJobRunner } from "./jobs.js";

type RouteDeps = {
  repo: AppRepository;
  integrations: IntegrationPort;
  jobs: InProcessJobRunner;
};

export async function registerPrinterSendQueueRoutes(
  app: FastifyInstance,
  deps: RouteDeps,
): Promise<void> {
  const makeStartJob = (tenantId: string) => async (payload: {
    printer_id: string;
    artifact_path: string;
    filename: string;
    start: boolean;
    host_name?: string;
    profile_id?: number;
    checkoff_units?: ReturnType<typeof parseCheckoffUnits>;
  }) =>
    deps.jobs.start(
      "printer-upload",
      {
        ...payload,
        upload_job_id: undefined,
      },
      tenantId,
    );

  const getStatus = (integrationId: string) => deps.integrations.getStatus(integrationId);

  app.get("/printer-send-queue", async (request) => {
    const query = request.query as { active?: string };
    if (query.active === "1" || query.active === "true") {
      return { items: listActivePrinterSendQueue(deps.repo) };
    }
    return { items: loadPrinterSendQueue(deps.repo) };
  });

  app.post(
    "/printer-send-queue",
    { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } },
    async (request, reply) => {
      let printerId = "";
      let start = false;
      let waitForIdle = true;
      let match: "pinned" | "compatible" = "pinned";
      let filename = "print.gcode";
      let artifactPath: string | null = null;
      let profileId: number | undefined;
      let checkoffUnitsRaw: string | undefined;

      try {
        for await (const part of request.parts()) {
          if (part.type === "field") {
            const value = String(await part.value);
            if (part.fieldname === "printer_id") printerId = value.trim();
            if (part.fieldname === "start") {
              const raw = value.toLowerCase();
              start = raw === "1" || raw === "true" || raw === "yes";
            }
            if (part.fieldname === "wait_for_idle") {
              const raw = value.toLowerCase();
              waitForIdle = !(raw === "0" || raw === "false" || raw === "no");
            }
            if (part.fieldname === "match") {
              const raw = value.trim().toLowerCase();
              if (raw === "compatible") match = "compatible";
              else if (raw === "pinned") match = "pinned";
            }
            if (part.fieldname === "profile_id") {
              const n = Number(value);
              if (Number.isInteger(n) && n > 0) profileId = n;
            }
            if (part.fieldname === "checkoff_units") {
              checkoffUnitsRaw = value;
            }
            continue;
          }
          if (part.type !== "file") continue;
          if (part.fieldname !== "file" && part.fieldname !== "gcode") {
            part.file.resume();
            continue;
          }
          if (artifactPath) {
            part.file.resume();
            return sendProblem(reply, 400, "Bad Request", "Only one G-code file is allowed");
          }
          filename = (part.filename || "print.gcode").replace(/\\/g, "/");
          try {
            artifactPath = await streamPrinterUploadArtifact(
              deps.jobs.getExportsDir(),
              randomUUID(),
              basename(filename),
              part.file,
            );
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            if (/size limit/i.test(message)) {
              return sendProblem(reply, 413, "Payload Too Large", message);
            }
            throw err;
          }
        }

        if (!printerId) {
          return sendProblem(reply, 400, "Bad Request", "printer_id is required");
        }
        if (!artifactPath) {
          return sendProblem(reply, 400, "Bad Request", "G-code file required");
        }

        const baseName = basename(filename);
        if (!isAllowedPrinterUploadFilename(baseName)) {
          return sendProblem(
            reply,
            400,
            "Bad Request",
            "Only .gcode / .bgcode / .gco files can be queued",
          );
        }

        const checkoff_units = parseCheckoffUnits(checkoffUnitsRaw);
        if (checkoff_units.length > 0 && profileId == null) {
          return sendProblem(
            reply,
            400,
            "Bad Request",
            "profile_id is required when checkoff_units are provided",
          );
        }
        if (profileId != null && !deps.repo.getProfile(profileId)) {
          return sendProblem(reply, 404, "Not Found", "Profile not found");
        }

        const machine = loadFleet(deps.repo).find((m) => m.id === printerId);
        if (!machine) {
          return sendProblem(reply, 404, "Not Found", "Fleet printer not found");
        }
        const integrationId = machine.integration_id?.trim();
        if (!integrationId) {
          return sendProblem(
            reply,
            400,
            "Bad Request",
            "Printer is not linked to a host. Link a Moonraker or PrusaLink host in Settings.",
          );
        }
        const integration = getIntegrationConfig(deps.repo, integrationId);
        if (!integration) {
          return sendProblem(reply, 400, "Bad Request", "Linked printer host was not found");
        }
        if (integration.type !== "moonraker" && integration.type !== "prusalink") {
          return sendProblem(
            reply,
            400,
            "Bad Request",
            `Queue is not supported for ${integration.type}`,
          );
        }

        const item = enqueuePrinterSend(deps.repo, {
          filename: baseName,
          artifact_path: artifactPath,
          printer_id: printerId,
          start,
          wait_for_idle: waitForIdle,
          match,
          profile_id: profileId,
          checkoff_units,
          host_name: integration.name,
        });
        if (!item) {
          return sendProblem(reply, 400, "Bad Request", "Could not enqueue item");
        }
        artifactPath = null;
        return { item };
      } finally {
        if (artifactPath) {
          try {
            rmSync(artifactPath, { force: true });
          } catch {
            /* ignore */
          }
        }
      }
    },
  );

  app.post(
    "/printer-send-queue/:id/dispatch",
    { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const id = String((request.params as { id: string }).id ?? "").trim();
      const body = (request.body ?? {}) as { force?: boolean };
      if (!id) return sendProblem(reply, 400, "Bad Request", "id is required");
      const result = await dispatchPrinterSendQueueItem(
        deps.repo,
        deps.jobs.getExportsDir(),
        id,
        {
          startJob: makeStartJob(request.tenantId ?? "default"),
          getStatus,
          force: Boolean(body.force),
        },
      );
      if ("error" in result) {
        return sendProblem(
          reply,
          result.status,
          result.status === 404
            ? "Not Found"
            : result.status === 409
              ? "Conflict"
              : result.status >= 500
                ? "Internal Server Error"
                : "Bad Request",
          result.error,
        );
      }
      return result;
    },
  );

  app.post(
    "/printer-send-queue/drain",
    { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } },
    async (request) => {
      const results = await drainPrinterSendQueue(deps.repo, deps.jobs.getExportsDir(), {
        startJob: makeStartJob(request.tenantId ?? "default"),
        getStatus,
      });
      return { results };
    },
  );

  app.delete("/printer-send-queue/:id", async (request, reply) => {
    const id = String((request.params as { id: string }).id ?? "").trim();
    if (!id) return sendProblem(reply, 400, "Bad Request", "id is required");
    const item = cancelPrinterSendQueueItem(deps.repo, id);
    if (!item) {
      return sendProblem(reply, 409, "Conflict", "Item not cancellable");
    }
    return { item };
  });
}
