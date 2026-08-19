import type { FastifyInstance } from "fastify";
import type { PrinterCheckoffLink, PrinterCheckoffUnit } from "@print-partner/contracts";
import type { AppRepository } from "../db/repository.js";
import type { IntegrationPort } from "../integrations/store.js";
import { getIntegrationAdapter } from "../integrations/registry.js";
import { getIntegrationConfig } from "../integrations/store.js";
import { sendProblem } from "../lib/api-error.js";
import { reconcilePrinterCheckoff } from "../services/printer-checkoff.js";
import {
  dismissHostFailedLink,
  verifyPrinterCheckoff,
} from "../services/printer-checkoff-verify.js";
import { dispatchWebhooks } from "../services/webhook-store.js";
import {
  createPrinterCheckoffLink,
  listAwaitingVerifyPrinterCheckoffLinks,
  listWatchingPrinterCheckoffLinks,
  loadPrinterCheckoffLinks,
  updatePrinterCheckoffLink,
} from "../services/printer-checkoff-store.js";
import { summarizePrintOutcomes } from "../services/printer-outcomes-store.js";
import {
  groupObjectsByPart,
  matchObjectsToFilenames,
} from "../services/gcode-object-parser.js";
import {
  claimUnattributedPrint,
  createUnattributedPrint,
  dismissUnattributedPrint,
  listOpenUnattributedPrints,
  listUnattributedPrints,
  saveUnattributedPrint,
} from "../services/unattributed-print-store.js";
import { normalizePrinterFilename } from "../services/printer-checkoff.js";
import { loadFleet } from "../services/printer-fleet.js";
import { deductSpoolmanFilamentAfterVerify } from "../services/spoolman-deduct.js";

type RouteDeps = {
  repo: AppRepository;
  integrations: IntegrationPort;
};

async function getObjectListForIntegration(
  repo: AppRepository,
  integrationId: string,
): Promise<string[]> {
  try {
    const integration = getIntegrationConfig(repo, integrationId);
    if (!integration) return [];
    const adapter = getIntegrationAdapter(integration.type);
    if (!adapter?.getObjectList) return [];
    return await adapter.getObjectList(integration.config);
  } catch {
    return [];
  }
}

async function buildCandidatesFromObjectNames(
  repo: AppRepository,
  objectNames: string[],
): Promise<Array<{ stl_basename: string; copy_count: number; matching_filenames: string[] }>> {
  if (!objectNames.length) return [];

  // Get all filenames from all profiles
  const profiles = repo.listProfiles();
  const allFilenames: string[] = [];
  for (const profile of profiles) {
    const { parts } = repo.listParts(profile.id, 10000, 0);
    for (const part of parts) {
      if (part.filename && !allFilenames.includes(part.filename)) {
        allFilenames.push(part.filename);
      }
    }
  }

  const grouped = groupObjectsByPart(objectNames);
  const matched = matchObjectsToFilenames(grouped, allFilenames);

  const candidates: Array<{
    stl_basename: string;
    copy_count: number;
    matching_filenames: string[];
  }> = [];
  for (const [stlBasename, plateMatch] of grouped) {
    candidates.push({
      stl_basename: stlBasename,
      copy_count: plateMatch.count,
      matching_filenames: matched.get(stlBasename) ?? [],
    });
  }
  return candidates;
}

function mapNamesToProfileUnits(
  repo: AppRepository,
  profileId: number,
  objectNames: string[],
  fallbackFilename?: string,
): {
  units: PrinterCheckoffUnit[];
  matchedNames: Set<string>;
  grouped: ReturnType<typeof groupObjectsByPart>;
  matched: ReturnType<typeof matchObjectsToFilenames>;
} {
  const partRows = repo.getProfilePartRows(profileId);
  for (const part of partRows) repo.ensureProgressForPart(part);
  const completedByPart = repo.printUnitsByPartId(profileId);

  const mapCandidates = (names: string[]) => {
    const grouped = groupObjectsByPart(names);
    const matched = matchObjectsToFilenames(
      grouped,
      partRows.map((part) => part.filename).filter(Boolean),
    );
    const units: PrinterCheckoffUnit[] = [];
    const used = new Set<string>();
    const matchedNames = new Set<string>();

    for (const [objectKey, matchedFiles] of matched) {
      const plateMatch = grouped.get(objectKey);
      if (!plateMatch || matchedFiles.length === 0) continue;
      let remaining = plateMatch.count;
      for (const filename of matchedFiles) {
        if (remaining === 0) break;
        const part = partRows.find(
          (row) => row.filename.toLowerCase() === filename.toLowerCase(),
        );
        if (!part) continue;
        const qty = Math.max(1, part.quantityEffective);
        const completed =
          completedByPart.get(part.id) ?? Array.from({ length: qty }, () => false);
        for (let unitIndex = 0; unitIndex < qty && remaining > 0; unitIndex += 1) {
          const key = `${part.id}:${unitIndex}`;
          if (completed[unitIndex] || used.has(key)) continue;
          used.add(key);
          units.push({ part_id: part.id, unit_index: unitIndex });
          remaining -= 1;
        }
        if (remaining < plateMatch.count) {
          for (const object of plateMatch.objects) matchedNames.add(object.name);
        }
      }
    }
    return { units, matchedNames, grouped, matched };
  };

  const mapped = mapCandidates(objectNames);
  if (mapped.units.length > 0 || !fallbackFilename?.trim()) return mapped;
  return mapCandidates([fallbackFilename]);
}

function repairEmptyAwaitingLinks(
  repo: AppRepository,
  links: PrinterCheckoffLink[],
): PrinterCheckoffLink[] {
  return links.map((link) => {
    if (link.state !== "awaiting_verify" || link.units.length > 0) return link;
    const mapped = mapNamesToProfileUnits(
      repo,
      link.profile_id,
      link.unlabeled_names ?? [],
      link.filename,
    );
    if (mapped.units.length === 0) return link;
    const unmatched = (link.unlabeled_names ?? []).filter(
      (name) => !mapped.matchedNames.has(name),
    );
    return (
      updatePrinterCheckoffLink(
        repo,
        link.id,
        {
          units: mapped.units,
          unlabeled_names: unmatched.length ? unmatched : undefined,
        },
        { requireState: "awaiting_verify" },
      ) ?? link
    );
  });
}

function repairLinkedUnattributedPrints(
  repo: AppRepository,
  integrationId?: string,
): void {
  const eligibleStates = new Set<PrinterCheckoffLink["state"]>([
    "watching",
    "awaiting_verify",
    "verified",
  ]);
  const links = loadPrinterCheckoffLinks(repo).filter(
    (link) =>
      eligibleStates.has(link.state) &&
      (!integrationId || link.integration_id === integrationId),
  );
  for (const print of listOpenUnattributedPrints(repo)) {
    if (integrationId && print.integration_id !== integrationId) continue;
    const normalizedFilename = normalizePrinterFilename(print.filename);
    const link = links.find(
      (candidate) =>
        candidate.integration_id === print.integration_id &&
        normalizePrinterFilename(candidate.filename) === normalizedFilename,
    );
    if (link) claimUnattributedPrint(repo, print.id, link.profile_id);
  }
}

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
      links = repairEmptyAwaitingLinks(deps.repo, links);
      if (integrationId) {
        links = links.filter((l) => l.integration_id === integrationId);
      }
      return { links };
    }

    let links = loadPrinterCheckoffLinks(deps.repo);
    links = repairEmptyAwaitingLinks(deps.repo, links);
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
      const integrationSummary = deps.integrations.get(integrationId);
      if (!integrationSummary) {
        return sendProblem(reply, 404, "Not Found", "Integration not found");
      }

      // Always fetch live host status — never trust a client-supplied snapshot.
      const status = await deps.integrations.getStatus(integrationId);
      const updates = reconcilePrinterCheckoff(deps.repo, integrationId, status);
      const createdLinks: PrinterCheckoffLink[] = [];

      // Handle externally-completed prints (no watching link transitioned)
      if (
        status.state === "complete" &&
        updates.length === 0 &&
        status.filename
      ) {
        const normalizedFilename = normalizePrinterFilename(status.filename);
        // Check if we already stored this as unattributed
        const existing = listUnattributedPrints(deps.repo).find(
          (p) =>
            p.integration_id === integrationId &&
            normalizePrinterFilename(p.filename) === normalizedFilename,
        );
        const existingLink = loadPrinterCheckoffLinks(deps.repo).find(
          (link) =>
            link.integration_id === integrationId &&
            normalizePrinterFilename(link.filename) === normalizedFilename,
        );
        if (!existing && !existingLink) {
          // Fetch object list from Moonraker
          const objectNames = await getObjectListForIntegration(
            deps.repo,
            integrationId,
          );
          // Compute candidates
          const candidates = await buildCandidatesFromObjectNames(
            deps.repo,
            objectNames,
          );
          const unattributedPrint = createUnattributedPrint(
            integrationId,
            "default", // printer_id - use "default" for Moonraker's single printer
            integrationSummary.name || "Printer",
            status.filename,
            objectNames,
            candidates,
          );
          saveUnattributedPrint(deps.repo, unattributedPrint);
        }
      }

      repairLinkedUnattributedPrints(deps.repo, integrationId);
      const openUnattributed = listOpenUnattributedPrints(deps.repo).filter(
        (p) => p.integration_id === integrationId,
      );

      // Auto-create watching link when a new print is detected on a printer with a default plan binding
      if (
        (status.state === "printing" || status.state === "paused") &&
        status.filename
      ) {
        const normalizedFilename = normalizePrinterFilename(status.filename);

        // Check if there's already a watching link for this integration+filename
        const watching = listWatchingPrinterCheckoffLinks(deps.repo, integrationId);
        const alreadyWatching = watching.some(
          (l) => normalizePrinterFilename(l.filename) === normalizedFilename,
        );

        if (!alreadyWatching) {
          // Look up default plan binding for this integration
          const bindingsRaw = deps.repo.getSetting("printer.plan_bindings");
          const bindings: Array<{ integration_id: string; profile_id: number | null }> =
            bindingsRaw ? JSON.parse(bindingsRaw) : [];
          const binding = bindings.find((b) => b.integration_id === integrationId);

          if (binding?.profile_id) {
            // Fetch object list and match to parts
            const objectNames = await getObjectListForIntegration(deps.repo, integrationId);
            const mapping = mapNamesToProfileUnits(
              deps.repo,
              binding.profile_id,
              objectNames,
              status.filename,
            );
            const { units } = mapping;

            // Get printer_id from fleet
            const fleet = loadFleet(deps.repo);
            const machine = fleet.find((m) => m.integration_id === integrationId);

            // Create watching link
            const createdLink = createPrinterCheckoffLink(deps.repo, {
              profile_id: binding.profile_id,
              integration_id: integrationId,
              printer_id: machine?.id ?? integrationId,
              host_name: integrationSummary.name,
              filename: normalizePrinterFilename(status.filename) || status.filename,
              units,
              started: false,
            });
            if (createdLink) createdLinks.push(createdLink);
          }
        }
      }

      // Keep `applied` alias empty for older clients; prefer `updates`.
      return {
        status,
        updates,
        created_links: createdLinks,
        applied: [],
        unattributed: openUnattributed,
      };
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

      // Dispatch print.verified / print.rejected webhooks for confirmed and rejected units.
      const { link, units_confirmed, units_rejected } = result;
      const webhookBase = {
        link_id: link.id,
        profile_id: link.profile_id,
        filename: link.filename,
        integration_id: link.integration_id,
      };
      if (units_confirmed > 0) {
        void dispatchWebhooks(deps.repo, "print.verified", {
          ...webhookBase,
          units_confirmed,
        });
      }
      if (units_rejected > 0) {
        void dispatchWebhooks(deps.repo, "print.rejected", {
          ...webhookBase,
          units_rejected,
        });
      }

      // Best-effort: deduct consumed filament from Spoolman when units are confirmed.
      if (units_confirmed > 0) {
        const rawDecisions = (request.body as { decisions?: unknown }).decisions;
        const confirmedDecisions = Array.isArray(rawDecisions)
          ? rawDecisions.filter(
              (d): d is { part_id: number; unit_index: number; result: "confirmed" } =>
                !!d &&
                typeof d === "object" &&
                (d as { result?: unknown }).result === "confirmed" &&
                typeof (d as { part_id?: unknown }).part_id === "number" &&
                typeof (d as { unit_index?: unknown }).unit_index === "number",
            )
          : [];
        void deductSpoolmanFilamentAfterVerify(
          deps.repo,
          link.integration_id,
          link.profile_id,
          confirmedDecisions,
          link.units.length,
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

  // --- Unattributed prints routes ---

  app.get("/printer-checkoff/unattributed", async () => {
    repairLinkedUnattributedPrints(deps.repo);
    const prints = listOpenUnattributedPrints(deps.repo);
    return { prints };
  });

  app.post(
    "/printer-checkoff/unattributed/:id/claim",
    { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const body = request.body as { profile_id?: unknown };
      const profileId = Number(body.profile_id);
      if (!Number.isInteger(profileId) || profileId <= 0) {
        return sendProblem(reply, 400, "Bad Request", "profile_id is required");
      }

      const allPrints = listUnattributedPrints(deps.repo);
      const print = allPrints.find((p) => p.id === id);
      if (!print) {
        return sendProblem(reply, 404, "Not Found", "Unattributed print not found");
      }
      if (print.claimed_at) {
        return sendProblem(reply, 409, "Conflict", "Print already claimed");
      }

      // Find matching parts in the profile for each candidate
      const partRows = deps.repo.getProfilePartRows(profileId);
      const units: Array<{ part_id: number; unit_index: number }> = [];

      for (const candidate of print.candidates) {
        if (!candidate.matching_filenames.length) continue;
        // Find parts in this profile that match
        const matchingParts = partRows.filter((p) =>
          candidate.matching_filenames.some(
            (mf) => mf.toLowerCase() === p.filename.toLowerCase(),
          ),
        );
        for (const part of matchingParts) {
          // Add units for each copy on the plate
          const qty = Math.max(1, part.quantityEffective);
          for (let i = 0; i < Math.min(candidate.copy_count, qty); i++) {
            units.push({ part_id: part.id, unit_index: i });
          }
        }
      }

      // Create a CheckoffLink directly in awaiting_verify state
      const link = createPrinterCheckoffLink(deps.repo, {
        profile_id: profileId,
        integration_id: print.integration_id,
        printer_id: print.printer_id,
        host_name: print.host_name,
        filename: print.filename,
        units,
        started: true,
      });
      if (!link) {
        return sendProblem(reply, 500, "Internal Server Error", "Failed to create checkoff link");
      }

      // Immediately transition to awaiting_verify
      const updated = updatePrinterCheckoffLink(
        deps.repo,
        link.id,
        {
          state: "awaiting_verify",
          host_outcome: "success",
          completed_at: print.completed_at,
          saw_active: true,
        },
        { requireState: "watching" },
      );

      // Mark as claimed
      claimUnattributedPrint(deps.repo, id, profileId);

      // Update the default plan binding for this printer to the claimed plan
      const bindingsRaw = deps.repo.getSetting("printer.plan_bindings");
      const claimBindings: Array<{ integration_id: string; profile_id: number | null; updated_at: string }> =
        bindingsRaw ? JSON.parse(bindingsRaw) : [];
      const claimIdx = claimBindings.findIndex((b) => b.integration_id === print.integration_id);
      const claimEntry = { integration_id: print.integration_id, profile_id: profileId, updated_at: new Date().toISOString() };
      if (claimIdx >= 0) claimBindings[claimIdx] = claimEntry; else claimBindings.push(claimEntry);
      deps.repo.setSetting("printer.plan_bindings", JSON.stringify(claimBindings));

      return { link: updated ?? link, ok: true };
    },
  );

  app.post(
    "/printer-checkoff/unattributed/:id/dismiss",
    { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const ok = dismissUnattributedPrint(deps.repo, id);
      if (!ok) {
        return sendProblem(reply, 404, "Not Found", "Unattributed print not found");
      }
      return { ok: true };
    },
  );
}
