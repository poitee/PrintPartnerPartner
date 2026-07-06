import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createSource,
  deleteSource,
  fetchSources,
  updateSource,
  type SourceSummary,
} from "../api/engine";
import { queryKeys } from "./keys";

export function useSourcesQuery(enabled = true) {
  return useQuery({
    queryKey: queryKeys.sources,
    queryFn: fetchSources,
    enabled,
  });
}

export function useCreateSourceMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: createSource,
    onSuccess: () => void qc.invalidateQueries({ queryKey: queryKeys.sources }),
  });
}

export function useUpdateSourceMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: number; body: Parameters<typeof updateSource>[1] }) =>
      updateSource(id, body),
    onSuccess: () => void qc.invalidateQueries({ queryKey: queryKeys.sources }),
  });
}

export function useDeleteSourceMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => deleteSource(id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: queryKeys.sources }),
  });
}

export function invalidateSources(qc: ReturnType<typeof useQueryClient>) {
  return qc.invalidateQueries({ queryKey: queryKeys.sources });
}

export type { SourceSummary };
