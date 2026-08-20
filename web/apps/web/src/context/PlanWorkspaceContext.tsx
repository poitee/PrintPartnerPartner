import { useQueryClient } from "@tanstack/react-query";
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { PlanReview } from "../api/engine";
import { formatCheckoffSummary } from "../lib/checkoffProgress";
import { useEngineHealth } from "../hooks/useEngineHealth";
import {
  invalidatePlanReview,
  usePatchPartAssembledMutation,
  usePatchPartMutation,
  usePatchPartProgressMutation,
  usePlanReviewQuery,
} from "../queries/planReview";
import { invalidateProfiles } from "../queries/profiles";
import { useProfileSelection } from "./ProfileContext";

type PlanWorkspaceValue = {
  review: PlanReview | null;
  loading: boolean;
  error: string | null;
  progressSummary: string;
  refresh: () => Promise<void>;
  setQuantity: (partId: number, qty: number) => Promise<void>;
  setIncluded: (partId: number, included: boolean) => Promise<void>;
  setSpoolmanSpool: (partId: number, spoolman_spool_id: string | null) => Promise<void>;
  toggleUnit: (partId: number, unitIndex: number, completed: boolean) => Promise<void>;
  toggleAssembled: (partId: number, unitIndex: number, assembled: boolean) => Promise<void>;
  busyPartId: number | null;
};

const PlanWorkspaceContext = createContext<PlanWorkspaceValue | null>(null);

function summaryFromReview(review: PlanReview | null): string {
  if (!review) return "";
  const parts = review.part_groups.flatMap((g) => g.parts).filter((p) => p.included);
  return formatCheckoffSummary(
    parts.map((p) => ({
      quantity_effective: p.quantity_effective,
      printed_count: p.printed_count,
      missing: p.missing,
    })),
  );
}

export function PlanWorkspaceProvider({ children }: { children: ReactNode }) {
  const { health } = useEngineHealth();
  const { selectedProfileId } = useProfileSelection();
  const queryClient = useQueryClient();
  const [busyPartId, setBusyPartId] = useState<number | null>(null);

  const {
    data: review = null,
    isLoading,
    error: queryError,
  } = usePlanReviewQuery(selectedProfileId, {
    includeExcluded: false,
    enabled: Boolean(health?.ok),
  });

  const patchPartMutation = usePatchPartMutation(selectedProfileId);
  const patchProgressMutation = usePatchPartProgressMutation(
    selectedProfileId,
    false,
  );
  const patchAssembledMutation = usePatchPartAssembledMutation(
    selectedProfileId,
    false,
  );

  const refresh = useCallback(async () => {
    if (!health?.ok || selectedProfileId == null) return;
    await Promise.all([
      invalidatePlanReview(queryClient, selectedProfileId),
      invalidateProfiles(queryClient),
    ]);
  }, [health?.ok, queryClient, selectedProfileId]);

  const setQuantity = useCallback(
    async (partId: number, qty: number) => {
      if (!review) return;
      const clamped = Math.max(1, Math.floor(qty));
      setBusyPartId(partId);
      try {
        await patchPartMutation.mutateAsync({
          partId,
          body: { quantity_override: clamped },
        });
      } finally {
        setBusyPartId(null);
      }
    },
    [review, patchPartMutation],
  );

  const setIncluded = useCallback(
    async (partId: number, included: boolean) => {
      if (!review) return;
      setBusyPartId(partId);
      try {
        await patchPartMutation.mutateAsync({ partId, body: { included } });
      } finally {
        setBusyPartId(null);
      }
    },
    [review, patchPartMutation],
  );

  const setSpoolmanSpool = useCallback(
    async (partId: number, spoolman_spool_id: string | null) => {
      if (!review) return;
      setBusyPartId(partId);
      try {
        await patchPartMutation.mutateAsync({
          partId,
          body: { spoolman_spool_id },
        });
      } finally {
        setBusyPartId(null);
      }
    },
    [review, patchPartMutation],
  );

  const toggleUnit = useCallback(
    async (partId: number, unitIndex: number, completed: boolean) => {
      if (!review) return;
      setBusyPartId(partId);
      try {
        await patchProgressMutation.mutateAsync({
          partId,
          unitIndex,
          completed,
          optimisticReview: review,
        });
      } finally {
        setBusyPartId(null);
      }
    },
    [review, patchProgressMutation],
  );

  const toggleAssembled = useCallback(
    async (partId: number, unitIndex: number, assembled: boolean) => {
      if (!review) return;
      setBusyPartId(partId);
      try {
        await patchAssembledMutation.mutateAsync({
          partId,
          unitIndex,
          assembled,
          optimisticReview: review,
        });
      } finally {
        setBusyPartId(null);
      }
    },
    [review, patchAssembledMutation],
  );

  const value = useMemo(
    (): PlanWorkspaceValue => ({
      review,
      loading: isLoading,
      error:
        queryError instanceof Error
          ? queryError.message
          : queryError
            ? String(queryError)
            : null,
      progressSummary: summaryFromReview(review),
      refresh,
      setQuantity,
      setIncluded,
      setSpoolmanSpool,
      toggleUnit,
      toggleAssembled,
      busyPartId,
    }),
    [
      review,
      isLoading,
      queryError,
      refresh,
      setQuantity,
      setIncluded,
      setSpoolmanSpool,
      toggleUnit,
      toggleAssembled,
      busyPartId,
    ],
  );

  return (
    <PlanWorkspaceContext.Provider value={value}>{children}</PlanWorkspaceContext.Provider>
  );
}

export function usePlanWorkspace(): PlanWorkspaceValue {
  const ctx = useContext(PlanWorkspaceContext);
  if (!ctx) throw new Error("usePlanWorkspace requires PlanWorkspaceProvider");
  return ctx;
}
