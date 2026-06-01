import {
  kitPrintPlanFromDict,
  kitPrintPlanToDict,
  mergePartsToCopies,
  unprintedCopies,
  autoPlateLayout,
  type MergePartExport,
} from "@print-partner/domain";
import type { FastifyInstance } from "fastify";
import type { AppRepository } from "../db/repository.js";
import { buildPrintGroupRows } from "@print-partner/domain";
import { buildPlateWorkspace } from "../services/plate-workspace.js";
import { loadFleet } from "../services/printer-fleet.js";
import { loadKitPrintPlan, saveKitPrintPlan } from "../services/print-plan-store.js";

type RouteDeps = { repo: AppRepository };

export async function registerPrintPlanRoutes(
  app: FastifyInstance,
  deps: RouteDeps,
): Promise<void> {
  app.get("/plans/:id/print-plan", async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    if (!deps.repo.getProfile(id)) return reply.status(404).send({ detail: "Profile not found" });
    const plan = loadKitPrintPlan(deps.repo, id);
    return {
      profile_id: id,
      plan: {
        enabled_printer_ids: plan.enabled_printer_ids,
        group_assignments: plan.group_assignments,
        plate_layout: plan.plate_layout ? kitPrintPlanToDict(plan).plate_layout : null,
      },
    };
  });

  app.put("/plans/:id/print-plan", async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    if (!deps.repo.getProfile(id)) return reply.status(404).send({ detail: "Profile not found" });
    const body = request.body as Record<string, unknown>;
    const existing = loadKitPrintPlan(deps.repo, id);
    const merged = kitPrintPlanToDict(existing) as Record<string, unknown>;
    if (body.group_assignments && Object.keys(body.group_assignments as object).length === 0) {
      if (Object.keys(existing.group_assignments).length) delete body.group_assignments;
    }
    Object.assign(merged, body);
    const plan = kitPrintPlanFromDict(merged);
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
    plan.group_assignments = { ...(body.assignments ?? {}) };
    const enabled = new Set(plan.enabled_printer_ids);
    for (const printerId of Object.values(plan.group_assignments)) {
      if (printerId) enabled.add(printerId);
    }
    plan.enabled_printer_ids = [...enabled];
    saveKitPrintPlan(deps.repo, id, plan);
    const fleet = loadFleet(deps.repo);
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
