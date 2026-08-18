import {
  kitPrintPlanFromDict,
  kitPrintPlanToDict,
  type KitPrintPlan,
} from "@print-partner/domain";
import type { AppRepository } from "../db/repository.js";

function planKey(profileId: number): string {
  return `print_plan:${profileId}`;
}

function defaultKitPrintPlan(): KitPrintPlan {
  return {
    enabled_printer_ids: [],
    plate_layout: null,
    group_assignments: {},
    grouping_strategy: "location",
  };
}

export type PrintPlanWarningHandler = (message: string, error?: unknown) => void;

export function loadKitPrintPlan(
  repo: AppRepository,
  profileId: number,
  onWarning?: PrintPlanWarningHandler,
): KitPrintPlan {
  const raw = repo.getSetting(planKey(profileId));
  if (!raw) return defaultKitPrintPlan();
  let persisted: Record<string, unknown>;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      throw new TypeError("Persisted print plan must be an object");
    }
    persisted = parsed as Record<string, unknown>;
  } catch (error) {
    onWarning?.(`Ignoring invalid persisted print plan for profile ${profileId}`, error);
    return defaultKitPrintPlan();
  }

  const plan = defaultKitPrintPlan();
  const fields = [
    "enabled_printer_ids",
    "plate_layout",
    "group_assignments",
    "grouping_strategy",
  ] as const;
  for (const field of fields) {
    if (!(field in persisted)) continue;
    try {
      const decoded = kitPrintPlanFromDict({ [field]: persisted[field] });
      if (field === "enabled_printer_ids") plan.enabled_printer_ids = decoded.enabled_printer_ids;
      else if (field === "plate_layout") plan.plate_layout = decoded.plate_layout;
      else if (field === "group_assignments") plan.group_assignments = decoded.group_assignments;
      else plan.grouping_strategy = decoded.grouping_strategy;
    } catch (error) {
      onWarning?.(
        `Ignoring invalid persisted print-plan field ${field} for profile ${profileId}`,
        error,
      );
    }
  }
  return plan;
}

export function saveKitPrintPlan(
  repo: AppRepository,
  profileId: number,
  plan: KitPrintPlan,
): void {
  repo.setSetting(planKey(profileId), JSON.stringify(kitPrintPlanToDict(plan), null, 2));
}
