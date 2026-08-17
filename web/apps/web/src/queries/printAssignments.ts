import { useMutation, useQueryClient } from "@tanstack/react-query";
import { savePrintAssignments } from "../api/engine";
import { invalidatePlateWorkspace } from "./plateWorkspace";

/**
 * Manual print-assignment save — PUT /plans/:id/print-assignments.
 *
 * The endpoint replaces the plan's whole group_assignments map and returns
 * the recomputed plan + groups; re-packing the plate preview after a manual
 * override means the plate workspace query is the thing to invalidate, same
 * as the grouping-strategy mutation.
 */
export function useSavePrintAssignmentsMutation(profileId: number | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (assignments: Record<string, string>) =>
      savePrintAssignments(profileId!, assignments),
    onSuccess: () => {
      if (profileId != null) void invalidatePlateWorkspace(qc, profileId);
    },
  });
}
