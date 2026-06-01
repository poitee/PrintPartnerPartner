import { kitPlateLayoutFromDict, kitPlateLayoutToDict, type KitPlateLayout } from "./plate-plan.js";

export type KitPrintPlan = {
  enabled_printer_ids: string[];
  plate_layout: KitPlateLayout | null;
  group_assignments: Record<string, string>;
};

export function kitPrintPlanFromDict(data: Record<string, unknown>): KitPrintPlan {
  const layoutRaw = data.plate_layout;
  const assignmentsRaw = data.group_assignments;
  return {
    enabled_printer_ids: Array.isArray(data.enabled_printer_ids)
      ? data.enabled_printer_ids.map(String)
      : [],
    plate_layout:
      layoutRaw && typeof layoutRaw === "object"
        ? kitPlateLayoutFromDict(layoutRaw as Record<string, unknown>)
        : null,
    group_assignments:
      assignmentsRaw && typeof assignmentsRaw === "object"
        ? Object.fromEntries(
            Object.entries(assignmentsRaw as Record<string, unknown>).map(([k, v]) => [
              String(k),
              String(v),
            ]),
          )
        : {},
  };
}

export function kitPrintPlanToDict(plan: KitPrintPlan): Record<string, unknown> {
  const out: Record<string, unknown> = {
    enabled_printer_ids: [...plan.enabled_printer_ids],
    group_assignments: { ...plan.group_assignments },
  };
  if (plan.plate_layout) {
    out.plate_layout = kitPlateLayoutToDict(plan.plate_layout);
  }
  return out;
}
