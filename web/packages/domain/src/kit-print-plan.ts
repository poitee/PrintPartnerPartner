import { kitPlateLayoutFromDict, kitPlateLayoutToDict, type KitPlateLayout } from "./plate-plan.js";
import type { GroupingStrategy } from "./plate-packer.js";

export type KitPrintPlan = {
  enabled_printer_ids: string[];
  plate_layout: KitPlateLayout | null;
  group_assignments: Record<string, string>;
  /** Active grouping strategy for packing new plates. Defaults to "location". */
  grouping_strategy: GroupingStrategy;
};

function isGroupingStrategy(v: unknown): v is GroupingStrategy {
  return v === "location" || v === "height_band";
}

function invalid(path: string): never {
  throw new TypeError(`Invalid kit print plan: ${path}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validateCopyRef(value: unknown, path: string): void {
  if (!isRecord(value)) invalid(path);
  if (typeof value.match_key !== "string" || value.match_key.length === 0) {
    invalid(`${path}.match_key`);
  }
  if (!Number.isInteger(value.unit) || (value.unit as number) < 1) {
    invalid(`${path}.unit`);
  }
}

function validateCopyRefs(value: unknown, path: string): void {
  if (!Array.isArray(value)) invalid(path);
  value.forEach((ref, index) => validateCopyRef(ref, `${path}[${index}]`));
}

function validatePlateLayout(value: unknown): asserts value is Record<string, unknown> {
  if (!isRecord(value)) invalid("plate_layout");
  if (
    value.spacing_mm !== undefined &&
    (typeof value.spacing_mm !== "number" ||
      !Number.isFinite(value.spacing_mm) ||
      value.spacing_mm < 0)
  ) {
    invalid("plate_layout.spacing_mm");
  }
  if (value.printers !== undefined && !Array.isArray(value.printers)) {
    invalid("plate_layout.printers");
  }
  const printerIds = new Set<string>();
  for (const [index, printer] of (value.printers ?? []).entries()) {
    const path = `plate_layout.printers[${index}]`;
    if (!isRecord(printer)) invalid(path);
    if (typeof printer.printer_id !== "string" || printer.printer_id.length === 0) {
      invalid(`${path}.printer_id`);
    }
    if (printerIds.has(printer.printer_id)) invalid(`${path}.printer_id`);
    printerIds.add(printer.printer_id);
    if (printer.plates !== undefined && !Array.isArray(printer.plates)) {
      invalid(`${path}.plates`);
    }
    for (const [plateIndex, plate] of (printer.plates ?? []).entries()) {
      validateCopyRefs(plate, `${path}.plates[${plateIndex}]`);
    }
    if (printer.unassigned !== undefined) {
      validateCopyRefs(printer.unassigned, `${path}.unassigned`);
    }
  }
  if (value.pool !== undefined) validateCopyRefs(value.pool, "plate_layout.pool");
}

export function kitPrintPlanFromDict(data: Record<string, unknown>): KitPrintPlan {
  const layoutRaw = data.plate_layout;
  const assignmentsRaw = data.group_assignments;
  if (
    data.enabled_printer_ids !== undefined &&
    (!Array.isArray(data.enabled_printer_ids) ||
      data.enabled_printer_ids.some((id) => typeof id !== "string" || id.length === 0))
  ) {
    invalid("enabled_printer_ids");
  }
  if (layoutRaw !== undefined && layoutRaw !== null) validatePlateLayout(layoutRaw);
  if (assignmentsRaw !== undefined) {
    if (!isRecord(assignmentsRaw)) invalid("group_assignments");
    for (const value of Object.values(assignmentsRaw)) {
      if (typeof value !== "string" || value.length === 0) invalid("group_assignments");
    }
  }
  if (data.grouping_strategy !== undefined && !isGroupingStrategy(data.grouping_strategy)) {
    invalid("grouping_strategy");
  }
  return {
    enabled_printer_ids: Array.isArray(data.enabled_printer_ids)
      ? [...data.enabled_printer_ids]
      : [],
    plate_layout:
      layoutRaw && isRecord(layoutRaw) ? kitPlateLayoutFromDict(layoutRaw) : null,
    group_assignments:
      assignmentsRaw && isRecord(assignmentsRaw)
        ? Object.fromEntries(Object.entries(assignmentsRaw) as Array<[string, string]>)
        : {},
    grouping_strategy: isGroupingStrategy(data.grouping_strategy)
      ? data.grouping_strategy
      : "location",
  };
}

export function kitPrintPlanToDict(plan: KitPrintPlan): Record<string, unknown> {
  const out: Record<string, unknown> = {
    enabled_printer_ids: [...plan.enabled_printer_ids],
    group_assignments: { ...plan.group_assignments },
    grouping_strategy: plan.grouping_strategy,
  };
  if (plan.plate_layout) {
    out.plate_layout = kitPlateLayoutToDict(plan.plate_layout);
  }
  return out;
}
