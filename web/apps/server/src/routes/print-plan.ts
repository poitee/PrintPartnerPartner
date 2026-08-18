import {
  kitPrintPlanFromDict,
  kitPrintPlanToDict,
  mergePartsToCopies,
  unprintedCopies,
  autoPlateLayout,
  resolveEnabledPrinters,
  type MergePartExport,
} from "@print-partner/domain";
import type { FastifyInstance } from "fastify";
import type { AppRepository } from "../db/repository.js";
import { buildPrintGroupRows } from "@print-partner/domain";
import { buildPlateWorkspace } from "../services/plate-workspace.js";
import { loadFleet } from "../services/printer-fleet.js";
import { loadKitPrintPlan, saveKitPrintPlan } from "../services/print-plan-store.js";

type RouteDeps = { repo: AppRepository };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function registerPrintPlanRoutes(
  app: FastifyInstance,
  deps: RouteDeps,
): Promise<void> {
  app.get("/plans/:id/print-plan", async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    if (!deps.repo.getProfile(id)) return reply.status(404).send({ detail: "Profile not found" });
    const plan = loadKitPrintPlan(deps.repo, id, (message, error) => {
      request.log.warn({ err: error, profileId: id }, message);
    });
    return {
      profile_id: id,
      plan: {
        enabled_printer_ids: plan.enabled_printer_ids,
        group_assignments: plan.group_assignments,
        plate_layout: plan.plate_layout ? kitPrintPlanToDict(plan).plate_layout : null,
        grouping_strategy: plan.grouping_strategy,
      },
    };
  });

  app.put("/plans/:id/print-plan", async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    if (!deps.repo.getProfile(id)) return reply.status(404).send({ detail: "Profile not found" });
    if (!isRecord(request.body)) {
      return reply.status(400).send({ detail: "Print plan body must be an object" });
    }
    const body = request.body;
    const existing = loadKitPrintPlan(deps.repo, id, (message, error) => {
      request.log.warn({ err: error, profileId: id }, message);
    });
    const merged = kitPrintPlanToDict(existing) as Record<string, unknown>;
    const updates = { ...body };
    if (
      isRecord(updates.group_assignments) &&
      Object.keys(updates.group_assignments).length === 0 &&
      Object.keys(existing.group_assignments).length
    ) {
      delete updates.group_assignments;
    }
    Object.assign(merged, updates);
    let plan: ReturnType<typeof kitPrintPlanFromDict>;
    try {
      plan = kitPrintPlanFromDict(merged);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      request.log.warn({ err: error, profileId: id }, "Rejected malformed print-plan input");
      return reply.status(400).send({ detail: message });
    }
    saveKitPrintPlan(deps.repo, id, plan);
    return { profile_id: id, plan: kitPrintPlanToDict(plan) };
  });

  app.get("/plans/:id/print-groups", async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    if (!deps.repo.getProfile(id)) return reply.status(404).send({ detail: "Profile not found" });
    const plan = loadKitPrintPlan(deps.repo, id);
    const fleet = loadFleet(deps.repo);
    const { parts } = deps.repo.buildMergePartsForProfile(id);
    const copies = mergePartsToCopies(parts as MergePartExport[]);
    const groups = buildPrintGroupRows(copies, fleet, plan.group_assignments);
    return { profile_id: id, groups };
  });

  app.put("/plans/:id/print-assignments", async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    if (!deps.repo.getProfile(id)) return reply.status(404).send({ detail: "Profile not found" });
    const body = request.body as { assignments?: Record<string, string> };
    const plan = loadKitPrintPlan(deps.repo, id);
    const fleet = loadFleet(deps.repo);
    const enabledIds = new Set(
      resolveEnabledPrinters(fleet, plan.enabled_printer_ids).map((p) => p.id),
    );
    plan.group_assignments = Object.fromEntries(
      Object.entries(body.assignments ?? {}).filter(([, printerId]) => enabledIds.has(printerId)),
    );
    saveKitPrintPlan(deps.repo, id, plan);
    const { parts } = deps.repo.buildMergePartsForProfile(id);
    const copies = mergePartsToCopies(parts as MergePartExport[]);
    const groups = buildPrintGroupRows(copies, fleet, plan.group_assignments);
    return {
      profile_id: id,
      plan: kitPrintPlanToDict(plan),
      groups,
    };
  });

  app.get("/plans/:id/plate-workspace", async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    if (!deps.repo.getProfile(id)) return reply.status(404).send({ detail: "Profile not found" });
    return buildPlateWorkspace(deps.repo, id);
  });

  app.post("/plans/:id/print-plan/prepare-missing", async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    if (!deps.repo.getProfile(id)) return reply.status(404).send({ detail: "Profile not found" });
    const { parts, completedByMatchKey } = deps.repo.buildMergePartsForProfile(id);
    const copies = unprintedCopies(
      parts as MergePartExport[],
      completedByMatchKey,
      (p) => p != null && p.length > 0,
    );
    const fleet = loadFleet(deps.repo);
    const enabled = fleet.length ? [fleet[0]] : [];
    const [layout] = autoPlateLayout(enabled, copies, 4);
    const plan = loadKitPrintPlan(deps.repo, id);
    plan.plate_layout = layout;
    if (enabled.length) {
      plan.enabled_printer_ids = [enabled[0].id];
    }
    saveKitPrintPlan(deps.repo, id, plan);
    return {
      profile_id: id,
      copy_count: copies.length,
      plan: kitPrintPlanToDict(plan),
      layout: {
        spacing_mm: layout.spacing_mm,
        pool: layout.pool,
        printers: layout.printers,
      },
    };
  });
}
