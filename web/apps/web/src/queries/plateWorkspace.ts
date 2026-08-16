import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  fetchPlateWorkspace,
  savePrintPlan,
  type GroupingStrategy,
  type PlateWorkspace,
} from "../api/engine";
import { queryKeys } from "./keys";

/**
 * Packed-plate preview for a plan. The server re-packs on every read using the
 * plan's saved grouping strategy (buildPlateWorkspace → packCopiesGrouped), so
 * plate contents — and the height bands on them — always reflect the current
 * strategy and the current set of included parts.
 */
export function usePlateWorkspaceQuery(profileId: number | null, enabled = true) {
  return useQuery({
    queryKey: queryKeys.plateWorkspace(profileId ?? 0),
    queryFn: () => fetchPlateWorkspace(profileId!),
    enabled: enabled && profileId != null && profileId > 0,
  });
}

export function invalidatePlateWorkspace(
  qc: ReturnType<typeof useQueryClient>,
  profileId: number,
) {
  return qc.invalidateQueries({ queryKey: queryKeys.plateWorkspace(profileId) });
}

/**
 * Persist the grouping strategy and re-read the workspace, so switching
 * Location ↔ Height Band re-packs the plates (and relabels their bands).
 */
export function useGroupingStrategyMutation(profileId: number | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (strategy: GroupingStrategy) =>
      savePrintPlan(profileId!, { grouping_strategy: strategy }),
    onSuccess: () => {
      if (profileId != null) void invalidatePlateWorkspace(qc, profileId);
    },
  });
}

export type { PlateWorkspace };
