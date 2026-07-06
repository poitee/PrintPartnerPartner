import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { PlanReview } from "../api/engine";
import { formatCheckoffSummary } from "../lib/checkoffProgress";
import { useEngineHealth } from "../hooks/useEngineHealth";
import {
  usePatchPartMutation,
  usePatchPartProgressMutation,
  usePlanReviewQuery,
} from "../queries/planReview";
import { useProfileSelection } from "./ProfileContext";

type PlanWorkspaceValue = {
  review: PlanReview | null;
  loading: boolean;
  error: string | null;
  revision: number;
  loadedRevision: number;
  progressSummary: string;
  reload: (profileId: number, options?: { includeExcluded?: boolean }) => Promise<void>;
  invalidate: () => Promise<void>;
  bumpPlanRevision: () => Promise<void>;
  setQuantity: (partId: number, qty: number) => Promise<void>;
  setIncluded: (partId: number, included: boolean) => Promise<void>;
  setSpoolmanSpool: (partId: number, spoolman_spool_id: string | null) => Promise<void>;
  toggleUnit: (partId: number, unitIndex: number, completed: boolean) => Promise<void>;
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
  const [revision, setRevision] = useState(0);
  const [busyPartId, setBusyPartId] = useState<number | null>(null);
  const [includeExcluded, setIncludeExcluded] = useState(false);

  const {
    data: review = null,
    isLoading,
    error: queryError,
    refetch,
    dataUpdatedAt,
  } = usePlanReviewQuery(selectedProfileId, {
    includeExcluded,
    enabled: Boolean(health?.ok),
  });

  const patchPartMutation = usePatchPartMutation(selectedProfileId);
  const patchProgressMutation = usePatchPartProgressMutation(selectedProfileId);

  const invalidate = useCallback(async () => {
    setRevision((r) => r + 1);
    await refetch();
  }, [refetch]);

  const reload = useCallback(
    async (profileId: number, options?: { includeExcluded?: boolean }) => {
      if (!health?.ok) return;
      if (options?.includeExcluded != null) {
        setIncludeExcluded(options.includeExcluded);
      }
      if (profileId === selectedProfileId) {
        await refetch();
      }
    },
    [health?.ok, selectedProfileId, refetch],
  );

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

  const loadedRevision = revision;

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
      revision,
      loadedRevision: dataUpdatedAt > 0 ? revision : loadedRevision,
      progressSummary: summaryFromReview(review),
      reload,
      invalidate,
      bumpPlanRevision: invalidate,
      setQuantity,
      setIncluded,
      setSpoolmanSpool,
      toggleUnit,
      busyPartId,
    }),
    [
      review,
      isLoading,
      queryError,
      revision,
      dataUpdatedAt,
      loadedRevision,
      reload,
      invalidate,
      setQuantity,
      setIncluded,
      setSpoolmanSpool,
      toggleUnit,
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

export function usePlanRevisionBump(): () => Promise<void> {
  const ctx = useContext(PlanWorkspaceContext);
  return ctx?.invalidate ?? (async () => {});
}

export function useReviewEnterRefetch(active: boolean) {
  const { selectedProfileId } = useProfileSelection();
  const { revision, loadedRevision, reload } = usePlanWorkspace();

  useEffect(() => {
    if (!active || selectedProfileId == null) return;
    if (loadedRevision !== revision) {
      void reload(selectedProfileId);
    }
  }, [active, selectedProfileId, revision, loadedRevision, reload]);
}
