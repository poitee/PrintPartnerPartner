import type { PlanReview, ProfileSummary, SourceSummary } from "../api/engine";

/** Non-blocking Plan-page warning lines (mock “things worth a look”). */
export function buildPlanWarningLines(input: {
  buildStale: boolean;
  attachedSources: SourceSummary[];
  review: PlanReview | null | undefined;
  roleFilaments?: Array<{ role: string; part_count: number; filament_color_id: string | null; filament_custom_hex: string | null }>;
}): string[] {
  const lines: string[] = [];
  const { buildStale, attachedSources, review, roleFilaments } = input;

  const upstream = attachedSources.filter((s) => s.update_status === "updates_available");
  if (upstream.length > 0) {
    lines.push(
      `${upstream.length} source${upstream.length === 1 ? "" : "s"} updated upstream since this build`,
    );
  } else if (buildStale) {
    lines.push("Plan is stale — rebuild to apply source or pick changes");
  }

  const included =
    review?.part_groups.flatMap((g) => g.parts).filter((p) => p.included) ?? [];

  const noRole = included.filter((p) => {
    const role = (p.role ?? "").trim().toLowerCase();
    return !role || role === "unassigned";
  }).length;
  if (noRole > 0) {
    lines.push(
      `${noRole} part${noRole === 1 ? "" : "s"} have no filament role assigned`,
    );
  }

  const noColorRoles =
    roleFilaments?.filter(
      (r) => r.part_count > 0 && !r.filament_color_id && !r.filament_custom_hex,
    ).length ?? 0;
  if (noColorRoles > 0 && noRole === 0) {
    lines.push(
      `${noColorRoles} role${noColorRoles === 1 ? "" : "s"} still need a filament color`,
    );
  }

  const qtyOverrideMissing = included.filter(
    (p) => p.quantity_auto < 1 && (p.quantity_override == null || p.quantity_override < 1),
  ).length;
  // quantity_auto is always ≥1 from the parser; surface review messages about qty when present.
  void qtyOverrideMissing;

  for (const issue of review?.issues ?? []) {
    if (issue.severity !== "warning" && issue.severity !== "blocker") continue;
    // Skip duplicates of upstream/stale already covered above.
    if (issue.code === "unsynced_source" || issue.code === "layer_no_project") {
      lines.push(issue.message);
      continue;
    }
    if (issue.code === "no_included_parts") {
      lines.push(issue.message);
      continue;
    }
    if (issue.severity === "warning") {
      lines.push(issue.message);
    }
  }

  // Dedupe while preserving order
  const seen = new Set<string>();
  return lines.filter((t) => {
    const key = t.trim().toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function planHeaderSubtitle(input: {
  profile: ProfileSummary | undefined;
  sourceCount: number;
  partCount: number;
}): string {
  const name = input.profile?.name?.trim();
  const bits: string[] = [];
  if (name) bits.push(name);
  if (input.sourceCount > 0) {
    bits.push(`${input.sourceCount} source${input.sourceCount === 1 ? "" : "s"}`);
  }
  if (input.partCount > 0) {
    bits.push(`${input.partCount} part${input.partCount === 1 ? "" : "s"}`);
  }
  return bits.join(" · ") || "Attach sources, pick files, set role colors.";
}
