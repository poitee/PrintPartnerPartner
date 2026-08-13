import type { FastifyInstance } from "fastify";
import type { AppRepository } from "../db/repository.js";
import type { IntegrationPort } from "../integrations/store.js";
import { sendProblem } from "../lib/api-error.js";
import { reconcilePrinterCheckoff } from "../services/printer-checkoff.js";
import {
  dismissHostFailedLink,
  verifyPrinterCheckoff,
} from "../services/printer-checkoff-verify.js";
import {
  listAwaitingVerifyPrinterCheckoffLinks,
  listWatchingPrinterCheckoffLinks,
  loadPrinterCheckoffLinks,
} from "../services/printer-checkoff-store.js";
import { summarizePrintOutcomes } from "../services/printer-outcomes-store.js";

type RouteDeps = {
  repo: AppRepository;
  integrations: IntegrationPort;
};

export async function registerPrinterCheckoffRoutes(
  app: FastifyInstance,
  deps: RouteDeps,
): Promise<void> {
  app.get("/printer-checkoff", async (request) => {
    const query = request.query as {
      state?: string;
      integration_id?: string;
      profile_id?: string;
    };
    const integrationId = query.integration_id?.trim();
    const profileIdRaw = query.profile_id?.trim();
    const profileId =
      profileIdRaw && Number.isInteger(Number(profileIdRaw))
        ? Number(profileIdRaw)
        : undefined;

    if (query.state === "watching") {
      return { links: listWatchingPrinterCheckoffLinks(deps.repo, integrationId) };
    }
    if (query.state === "awaiting_verify") {
      let links = listAwaitingVerifyPrinterCheckoffLinks(deps.repo, profileId);
      if (integrationId) {
        links = links.filter((l) => l.integration_id === integrationId);
      }
      return { links };
    }

    let links = loadPrinterCheckoffLinks(deps.repo);
    if (integrationId) {
      links = links.filter((l) => l.integration_id === integrationId);
    }
    if (profileId != null) {
      links = links.filter((l) => l.profile_id === profileId);
    }
    if (
      query.state === "host_failed" ||
      query.state === "dismissed" ||
      query.state === "verified" ||
      query.state === "applied"
    ) {
      const want = query.state === "applied" ? "verified" : query.state;
      links = links.filter((l) => l.state === want);
    }
    return { links };
  });

  app.post(
    "/printer-checkoff/reconcile",
    { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const body = request.body as { integration_id?: string };
      const integrationId = String(body.integration_id ?? "").trim();
      if (!integrationId) {
        return sendProblem(reply, 400, "Bad Request", "integration_id is required");
      }
      if (!deps.integrations.get(integrationId)) {
        return sendProblem(reply, 404, "Not Found", "Integration not found");
      }

      // Always fetch live host status — never trust a client-supplied snapshot.
      const status = await deps.integrations.getStatus(integrationId);
      const updates = reconcilePrinterCheckoff(deps.repo, integrationId, status);
      // Keep `applied` alias empty for older clients; prefer `updates`.
      return { status, updates, applied: [] };
    },
  );

  app.post(
    "/printer-checkoff/verify",
    { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const body = request.body as { link_id?: string; decisions?: unknown };
      const linkId = String(body.link_id ?? "").trim();
      if (!linkId) {
        return sendProblem(reply, 400, "Bad Request", "link_id is required");
      }
      const result = verifyPrinterCheckoff(deps.repo, linkId, body.decisions);
      if ("error" in result) {
        return sendProblem(
          reply,
          result.status,
          result.status === 404 ? "Not Found" : result.status === 409 ? "Conflict" : "Bad Request",
          result.error,
        );
      }
      return result;
    },
  );

  app.post(
    "/printer-checkoff/dismiss",
    { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const body = request.body as { link_id?: string };
      const linkId = String(body.link_id ?? "").trim();
      if (!linkId) {
        return sendProblem(reply, 400, "Bad Request", "link_id is required");
      }
      const result = dismissHostFailedLink(deps.repo, linkId);
      if ("error" in result) {
        return sendProblem(
          reply,
          result.status,
          result.status === 404 ? "Not Found" : "Conflict",
          result.error,
        );
      }
      return { link: result };
    },
  );

  app.get("/printer-outcomes/summary", async (request, reply) => {
    const query = request.query as { profile_id?: string };
    const profileId = Number(query.profile_id);
    if (!Number.isInteger(profileId) || profileId <= 0) {
      return sendProblem(reply, 400, "Bad Request", "profile_id is required");
    }
    return summarizePrintOutcomes(deps.repo, profileId);
  });
}
