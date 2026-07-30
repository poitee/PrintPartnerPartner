import type { PlanDecision } from "@print-partner/contracts";
import type { AppRepository } from "../db/repository.js";

const MAX_PREFS_CHARS = 1800;
const MAX_DECISIONS = 80;
const MAX_PREFER_LINES = 8;
const MAX_AVOID_LINES = 6;

const PATTERN_KEYS = [
  "source_name",
  "preset_id",
  "tag",
  "branch",
  "base_id",
  "layer_id",
] as const;

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 20)}\n…[truncated]`;
}

/** Stable fingerprint for dismiss/avoid matching (action_type + canonical params). */
export function decisionFingerprint(
  actionType: string | null | undefined,
  params: Record<string, unknown> | null | undefined,
): string {
  const type = (actionType ?? "").trim() || "?";
  const p = params && typeof params === "object" ? params : {};
  const parts: string[] = [];
  for (const key of PATTERN_KEYS) {
    const v = p[key];
    if (v == null || v === "") continue;
    parts.push(`${key}=${String(v)}`);
  }
  if (p.selections && typeof p.selections === "object") {
    const sels = Object.entries(p.selections as Record<string, unknown>)
      .map(([k, v]) => `${k}=${String(v)}`)
      .sort();
    if (sels.length) parts.push(`selections={${sels.join(",")}}`);
  }
  parts.sort();
  return `${type}|${parts.join(";")}`;
}

function patternLabel(actionType: string, params: Record<string, unknown>): string {
  const bits: string[] = [actionType];
  for (const key of PATTERN_KEYS) {
    const v = params[key];
    if (v != null && v !== "") bits.push(`${key}=${String(v)}`);
  }
  if (params.selections && typeof params.selections === "object") {
    const keys = Object.keys(params.selections as Record<string, unknown>).slice(0, 6);
    if (keys.length) bits.push(`kit_keys=[${keys.join(",")}]`);
  }
  return bits.join(" ");
}

/**
 * Build "## User preferences (from this plan)" from recent plan_decisions.
 * Prefer repeated applied patterns; list dismissed fingerprints to avoid.
 */
export function buildPreferencesDigest(
  repo: AppRepository,
  planId: number,
  decisions?: PlanDecision[],
): string | null {
  const list = decisions ?? repo.listPlanDecisions(planId, MAX_DECISIONS);
  if (!list.length) return null;

  const appliedCounts = new Map<string, { count: number; label: string }>();
  const avoided = new Map<string, string>();

  for (const d of list) {
    if (d.kind === "applied_action" || d.kind === "choice") {
      const fp = decisionFingerprint(d.action_type, d.params);
      const label = patternLabel(d.action_type ?? "choice", d.params ?? {});
      const prev = appliedCounts.get(fp);
      appliedCounts.set(fp, { count: (prev?.count ?? 0) + 1, label });
    } else if (d.kind === "dismissed_action") {
      const fp = decisionFingerprint(d.action_type, d.params);
      avoided.set(fp, patternLabel(d.action_type ?? "action", d.params ?? {}));
    }
  }

  const preferLines = [...appliedCounts.entries()]
    .sort((a, b) => b[1].count - a[1].count || a[1].label.localeCompare(b[1].label))
    .slice(0, MAX_PREFER_LINES)
    .map(([, { count, label }]) => `- Prefer (${count}×): ${label}`);

  const avoidLines = [...avoided.values()]
    .slice(0, MAX_AVOID_LINES)
    .map((label) => `- Avoid re-proposing: ${label}`);

  if (!preferLines.length && !avoidLines.length) return null;

  return truncate(
    [
      "## User preferences (from this plan)",
      "Learned from Apply/Dismiss on this plan — not training data. Prefer applied patterns; do not re-propose recently dismissed fingerprints.",
      preferLines.length ? "### Prefer" : null,
      ...preferLines,
      avoidLines.length ? "### Avoid" : null,
      ...avoidLines,
    ]
      .filter(Boolean)
      .join("\n"),
    MAX_PREFS_CHARS,
  );
}

/** Whether a proposed action matches a dismissed fingerprint on this plan. */
export function isDismissedFingerprint(
  repo: AppRepository,
  planId: number,
  actionType: string,
  params: Record<string, unknown>,
): boolean {
  const fp = decisionFingerprint(actionType, params);
  const decisions = repo.listPlanDecisions(planId, MAX_DECISIONS);
  return decisions.some(
    (d) =>
      d.kind === "dismissed_action" &&
      decisionFingerprint(d.action_type, d.params) === fp,
  );
}
