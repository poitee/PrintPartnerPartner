/** Pure helpers for the Plans page list (GRE-228). */

export const PLANS_LIST_LIMIT = 16;

export type PlansListFilter = "active" | "archived" | "all";

export type PlansListRow = {
  id: number;
  name: string;
  archived_at: string | null;
  part_count: number;
  remaining_units: number;
  total_units: number;
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
