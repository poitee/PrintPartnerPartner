/** Pure helpers for the Plans page list (GRE-228). */

import type { AcceptedProgressSummary } from "@print-partner/contracts";

export const PLANS_LIST_LIMIT = 16;

export type PlansListFilter = "active" | "archived" | "all";

export type PlansListRow = {
  id: number;
  name: string;
  archived_at: string | null;
  part_count: number;
  accepted_progress: AcceptedProgressSummary;
  build_stale: boolean;
};

function isArchived(plan: { archived_at: string | null }): boolean {
  return plan.archived_at != null && plan.archived_at !== "";
}

function byName(a: { name: string }, b: { name: string }): number {
  return a.name.localeCompare(b.name);
}

/** Active / Archived / All — name-sorted, capped at PLANS_LIST_LIMIT (desk list, not a farm). */
export function filterPlansList<T extends PlansListRow>(
  plans: T[],
  filter: PlansListFilter,
): T[] {
  const filtered = plans.filter((p) => {
    if (filter === "active") return !isArchived(p);
    if (filter === "archived") return isArchived(p);
    return true;
  });
  return [...filtered].sort(byName).slice(0, PLANS_LIST_LIMIT);
}

export function planStatusLabel(plan: {
  archived_at: string | null;
}): "Active" | "Archived" {
  return isArchived(plan) ? "Archived" : "Active";
}

export function planProgressLabel(progress: AcceptedProgressSummary): string {
  switch (progress.kind) {
    case "ready":
      return progress.total_units === 0
        ? "No required units"
        : `${progress.remaining_units} remaining`;
    case "empty":
      return "Not applied";
    case "unavailable":
      return "Progress unavailable";
  }
}

export function canArchiveAcceptedPlan(plan: {
  readonly archived_at: string | null;
  readonly accepted_progress: AcceptedProgressSummary;
}): boolean {
  const progress = plan.accepted_progress;
  return (
    !isArchived(plan) &&
    progress.kind === "ready" &&
    progress.total_units > 0 &&
    progress.remaining_units === 0
  );
}
