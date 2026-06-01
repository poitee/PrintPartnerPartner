import {
  kitPrintPlanFromDict,
  kitPrintPlanToDict,
  type KitPrintPlan,
} from "@print-partner/domain";
import type { AppRepository } from "../db/repository.js";

function planKey(profileId: number): string {
  return `print_plan:${profileId}`;
}

export function loadKitPrintPlan(repo: AppRepository, profileId: number): KitPrintPlan {
  const raw = repo.getSetting(planKey(profileId));
  if (!raw) {
    return { enabled_printer_ids: [], plate_layout: null, group_assignments: {} };
  }
  try {
    return kitPrintPlanFromDict(JSON.parse(raw) as Record<string, unknown>);
  } catch {
    return { enabled_printer_ids: [], plate_layout: null, group_assignments: {} };
  }
}

export function saveKitPrintPlan(
  repo: AppRepository,
  profileId: number,
  plan: KitPrintPlan,
): void {
  repo.setSetting(planKey(profileId), JSON.stringify(kitPrintPlanToDict(plan), null, 2));
}
