import { randomUUID } from "node:crypto";
import type { AssistantProposedAction } from "@print-partner/contracts";

export type SyncThenUpdateParams = {
  planId: number;
  projectIds?: number[];
  sourceName?: string | null;
};

/**
 * Single confirm-to-apply card: Sync source(s) then Update build (recompute).
 * Uses apply_build_recipe so Apply runs both steps in order.
 */
export function buildSyncThenUpdateAction(
  params: SyncThenUpdateParams,
): AssistantProposedAction {
  const projectIds = (params.projectIds ?? []).filter((id) => Number.isFinite(id) && id > 0);
  const sourceName = params.sourceName?.trim() || undefined;
  const syncParams: Record<string, unknown> = {};
  if (projectIds.length > 0) syncParams.project_ids = [...new Set(projectIds)];
  if (sourceName) syncParams.source_name = sourceName;

  const who =
    sourceName ??
    (projectIds.length === 1
      ? `source #${projectIds[0]}`
      : projectIds.length > 1
        ? `${projectIds.length} sources`
        : "sources");

  return {
    id: randomUUID(),
    type: "apply_build_recipe",
    plan_id: params.planId,
    label: "Sync → Update build",
    summary: `Sync ${who}, then recompute plan #${params.planId} so Review/Checkoff pick up the new files.`,
    params: {
      workflow: "sync_then_recompute",
      steps: [
        {
          type: "start_sync",
          label: sourceName ? `Sync ${sourceName}` : "Sync sources",
          summary: sourceName
            ? `Enqueue sync for ${sourceName}.`
            : projectIds.length
              ? `Enqueue sync for source id(s): ${projectIds.join(", ")}.`
              : "Enqueue sync for all sources.",
          params: syncParams,
        },
        {
          type: "start_recompute",
          label: "Update build",
          summary: `Recompute plan #${params.planId} after sync.`,
          params: { apply_manifest: true },
        },
      ],
    },
  };
}
