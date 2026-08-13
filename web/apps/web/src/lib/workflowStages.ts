import type { PlanReview, ProfileSummary } from "../api/engine";
import {
  exportRoute,
  libraryRoute,
  partsRoute,
  planRoute,
  progressRoute,
} from "./routes";

export type WorkflowStageId = "library" | "plan" | "parts" | "progress" | "export";

/** Stages that participate in the spine progress fill (not Export). */
export const SPINE_FILL_STAGE_IDS: ReadonlySet<WorkflowStageId> = new Set([
  "library",
  "plan",
  "parts",
  "progress",
]);

export type WorkflowStage = {
  id: WorkflowStageId;
  label: string;
  to: string;
  /** Mono meta shown in the rail / mobile bar (count, %, sources). */
  meta: string;
  warn: boolean;
  done: boolean;
  dim: boolean;
};

export type WorkflowStageInput = {
  pathname: string;
  sourcesCount: number;
  profiles: ProfileSummary[];
  selectedProfileId: number | null;
  /** Attached source count for the active plan when known. */
  attachedSourceCount?: number | null;
  review?: PlanReview | null;
};

function printedProgress(review: PlanReview | null | undefined): {
  pct: number;
  printedUnits: number;
  totalUnits: number;
  partCount: number;
  warnCount: number;
} {
  if (!review) {
    return { pct: 0, printedUnits: 0, totalUnits: 0, partCount: 0, warnCount: 0 };
  }
  const parts = review.part_groups.flatMap((g) => g.parts).filter((p) => p.included);
  const totalUnits = parts.reduce((sum, p) => sum + Math.max(1, p.quantity_effective), 0);
  const printedUnits = parts.reduce((sum, p) => sum + p.printed_count, 0);
  const pct =
    totalUnits > 0
      ? Math.min(100, Math.round((printedUnits / totalUnits) * 100))
      : 0;
  const issueWarnCount =
    review.issues?.filter(
      (i) => i.severity === "warning" || i.severity === "blocker",
    ).length ?? 0;
  const warnCount = issueWarnCount + parts.filter((p) => p.missing).length;
  return {
    pct,
    printedUnits,
    totalUnits,
    partCount: parts.length,
    warnCount,
  };
}

/** Build always-visible workflow stages (plus Export hub) with live plan meta. */
export function buildWorkflowStages(input: WorkflowStageInput): WorkflowStage[] {
  const {
    sourcesCount,
    profiles,
    selectedProfileId,
    attachedSourceCount,
    review,
  } = input;
  const selected = profiles.find((p) => p.id === selectedProfileId);
  const hasSources = sourcesCount > 0;
  const hasPlan = profiles.length > 0;
  const buildStale = selected?.build_stale ?? false;
  const partCount = selected?.part_count ?? review?.totals.included_parts ?? 0;
  const hasParts = partCount > 0;
  const progress = printedProgress(review);
  const layersAttached =
    review?.layers?.filter((l) => l.project_id != null).length ?? 0;
  const attached =
    attachedSourceCount ?? (layersAttached > 0 ? layersAttached : null);
  const exportMetaCount = progress.partCount || partCount;

  const planMeta =
    attached != null && attached > 0
      ? `${attached} source${attached === 1 ? "" : "s"}`
      : hasPlan
        ? hasParts
          ? `${partCount}`
          : "—"
        : "";

  const partsWarn =
    buildStale ||
    (review?.has_blockers ?? false) ||
    (progress.warnCount > 0 && hasParts);

  return [
    {
      id: "library",
      label: "Library",
      to: libraryRoute(),
      meta: hasSources ? String(sourcesCount) : "0",
      warn: !hasSources,
      done: hasSources,
      dim: !hasSources,
    },
    {
      id: "plan",
      label: "Plan",
      to: planRoute(selectedProfileId),
      meta: planMeta,
      warn: hasPlan && (buildStale || !hasParts),
      done: hasPlan && hasParts && !buildStale,
      dim: !hasPlan,
    },
    {
      id: "parts",
      label: "Parts",
      to: partsRoute(selectedProfileId),
      meta: hasParts ? String(progress.partCount || partCount) : "",
      warn: partsWarn && hasParts,
      done: hasParts && !buildStale && !(review?.has_blockers ?? false),
      dim: !hasParts,
    },
    {
      id: "progress",
      label: "Progress",
      to: progressRoute(selectedProfileId),
      meta: hasParts ? `${progress.pct}%` : "",
      warn: false,
      done: hasParts && progress.pct >= 100,
      dim: !hasParts || progress.pct === 0,
    },
    {
      id: "export",
      label: "Export",
      to: exportRoute(selectedProfileId),
      meta: hasParts ? String(exportMetaCount) : "",
      warn: false,
      done: hasParts,
      dim: !hasParts,
    },
  ];
}

/** Index of the furthest completed / active stage for spine fill (Library→Progress only). */
export function spineFillIndex(stages: WorkflowStage[], activeId: WorkflowStageId | null): number {
  const fillStages = stages.filter((s) => SPINE_FILL_STAGE_IDS.has(s.id));
  const fillActive =
    activeId && SPINE_FILL_STAGE_IDS.has(activeId) ? activeId : null;
  if (fillActive) {
    const activeIdx = fillStages.findIndex((s) => s.id === fillActive);
    if (activeIdx >= 0) return activeIdx;
  }
  let lastDone = -1;
  for (let i = 0; i < fillStages.length; i++) {
    if (fillStages[i]?.done) lastDone = i;
  }
  return Math.max(0, lastDone);
}

/** How many leading stages participate in the spine track (before Export). */
export function spineFillStageCount(stages: WorkflowStage[]): number {
  return stages.filter((s) => SPINE_FILL_STAGE_IDS.has(s.id)).length;
}

export function stageIdFromPath(pathname: string): WorkflowStageId | null {
  if (pathname === "/library" || pathname === "/sources") return "library";
  if (pathname === "/plan" || pathname === "/build") return "plan";
  if (pathname === "/parts" || pathname === "/review") return "parts";
  if (pathname === "/progress" || pathname === "/checkoff") return "progress";
  if (pathname === "/export") return "export";
  return null;
}

/** Shared printed-unit totals for the plan tray. */
export function planPrintTotals(review: PlanReview | null | undefined) {
  return printedProgress(review);
}
