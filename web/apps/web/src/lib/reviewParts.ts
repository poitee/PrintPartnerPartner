import type { PartRow, PlanReview, PlanReviewPartGroup } from "../api/engine";

/** Human-readable source name from `base:repo-name` / `addon:repo-name` layer labels. */
export function sourceLabelFromLayer(sourceLayer: string | null | undefined): string {
  if (!sourceLayer) return "Other";
  const colon = sourceLayer.indexOf(":");
  return colon >= 0 ? sourceLayer.slice(colon + 1) : sourceLayer;
}

export function flattenReviewParts(groups: PlanReviewPartGroup[]): PartRow[] {
  return groups.flatMap((g) => g.parts);
}

export function partitionIncludedParts(parts: PartRow[]): {
  included: PartRow[];
  excluded: PartRow[];
} {
  const included: PartRow[] = [];
  const excluded: PartRow[] = [];
  for (const p of parts) {
    if (p.included) included.push(p);
    else excluded.push(p);
  }
  const byName = (a: PartRow, b: PartRow) => a.filename.localeCompare(b.filename);
  included.sort(byName);
  excluded.sort(byName);
  return { included, excluded };
}

export function filterPartsByQuery(parts: PartRow[], query: string): PartRow[] {
  const q = query.trim().toLowerCase();
  if (!q) return parts;
  return parts.filter((p) => {
    const hay = [
      p.filename,
      p.relative_path,
      p.role ?? "",
      sourceLabelFromLayer(p.source_layer),
    ]
      .join(" ")
      .toLowerCase();
    return hay.includes(q);
  });
}

/** Apply a PATCH response into review payload (totals omit filament breakdown). */
export function mergePartIntoReview(review: PlanReview, updated: PartRow): PlanReview {
  const part_groups = review.part_groups.map((g) => ({
    ...g,
    parts: g.parts.map((p) => (p.id === updated.id ? { ...p, ...updated } : p)),
  }));
  const all = flattenReviewParts(part_groups);
  const included = all.filter((p) => p.included);
  const by_role: Record<string, number> = {};
  let print_units = 0;
  for (const p of included) {
    const role = p.role || "primary";
    by_role[role] = (by_role[role] ?? 0) + 1;
    print_units += Math.max(1, p.quantity_effective);
  }
  return {
    ...review,
    part_groups,
    totals: {
      ...review.totals,
      included_parts: included.length,
      total_print_units: print_units,
      by_role,
    },
  };
}
