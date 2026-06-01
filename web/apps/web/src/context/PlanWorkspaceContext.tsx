import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  fetchPlanReview,
  patchPart,
  patchPartProgress,
  type PlanReview,
} from "../api/engine";
import { mergePartIntoReview, mergeProgressIntoReview } from "../lib/reviewParts";
import { formatCheckoffSummary } from "../lib/checkoffProgress";
import { useEngineHealth } from "../hooks/useEngineHealth";
import { useProfileSelection } from "./ProfileContext";

type PlanWorkspaceValue = {
  review: PlanReview | null;
  loading: boolean;
  error: string | null;
  revision: number;
  loadedRevision: number;
  progressSummary: string;
  reload: (profileId: number, options?: { includeExcluded?: boolean }) => Promise<void>;
  invalidate: () => void;
  /** Alias for invalidate — bumps revision so Review refetches after Build recompute. */
  bumpPlanRevision: () => void;
  setQuantity: (partId: number, qty: number) => Promise<void>;
  setIncluded: (partId: number, included: boolean) => Promise<void>;
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
  const [review, setReview] = useState<PlanReview | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const [loadedRevision, setLoadedRevision] = useState(0);
  const [busyPartId, setBusyPartId] = useState<number | null>(null);
  const profileIdRef = useRef<number | null>(null);
  const includeExcludedRef = useRef(false);
  const revisionRef = useRef(revision);
  revisionRef.current = revision;

  const invalidate = useCallback(() => {
    setRevision((r) => r + 1);
  }, []);

  const reload = useCallback(
    async (profileId: number, options?: { includeExcluded?: boolean }) => {
      if (!health?.ok) return;
      profileIdRef.current = profileId;
      if (options?.includeExcluded != null) {
        includeExcludedRef.current = options.includeExcluded;
      }
      setLoading(true);
      setError(null);
      try {
        const data = await fetchPlanReview(profileId, {
          includeExcluded: includeExcludedRef.current,
        });
        setReview(data);
        setLoadedRevision(revisionRef.current);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        setReview(null);
      } finally {
        setLoading(false);
      }
    },
    [health?.ok],
  );

  useEffect(() => {
    if (!health?.ok || selectedProfileId == null) {
      profileIdRef.current = null;
      setReview(null);
      return;
    }
    void reload(selectedProfileId);
  }, [health?.ok, selectedProfileId, reload]);

  useEffect(() => {
    if (selectedProfileId == null) return;
    if (loadedRevision < revision) {
      void reload(selectedProfileId);
    }
  }, [revision, loadedRevision, selectedProfileId, reload]);

  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState !== "visible") return;
      const pid = profileIdRef.current;
      if (pid == null) return;
      if (loadedRevision < revisionRef.current) {
        void reload(pid);
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [loadedRevision, reload]);

  const setQuantity = useCallback(
    async (partId: number, qty: number) => {
      if (!review) return;
      const clamped = Math.max(1, Math.floor(qty));
      const prev = review.part_groups
        .flatMap((g) => g.parts)
        .find((p) => p.id === partId);
      if (prev && clamped < prev.printed_count) {
        // qty reduced below printed count — server resyncs units on patch
      }
      setBusyPartId(partId);
      try {
        await patchPart(partId, { quantity_override: clamped });
        await reload(review.profile_id);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setBusyPartId(null);
      }
    },
    [review, reload],
  );

  const setIncluded = useCallback(
    async (partId: number, included: boolean) => {
      if (!review) return;
      setBusyPartId(partId);
      try {
        const updated = await patchPart(partId, { included });
        let next = mergePartIntoReview(review, updated);
        if (!included && !includeExcludedRef.current) {
          next = {
            ...next,
            part_groups: next.part_groups
              .map((g) => ({ ...g, parts: g.parts.filter((p) => p.id !== partId) }))
              .filter((g) => g.parts.length > 0),
          };
        }
        setReview(next);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        if (profileIdRef.current != null) await reload(profileIdRef.current);
      } finally {
        setBusyPartId(null);
      }
    },
    [review, reload],
  );

  const toggleUnit = useCallback(
    async (partId: number, unitIndex: number, completed: boolean) => {
      if (!review) return;
      const part = review.part_groups.flatMap((g) => g.parts).find((p) => p.id === partId);
      if (!part) return;
      setBusyPartId(partId);
      const optimisticUnits = [...part.print_units];
      while (optimisticUnits.length < part.quantity_effective) optimisticUnits.push(false);
      if (unitIndex < optimisticUnits.length) optimisticUnits[unitIndex] = completed;
      const optimisticPrinted = optimisticUnits.filter(Boolean).length;
      const optimisticMissing = optimisticPrinted < part.quantity_effective;
      setReview(
        mergeProgressIntoReview(review, partId, {
          printed_count: optimisticPrinted,
          print_units: optimisticUnits,
          missing: optimisticMissing,
        }),
      );
      try {
        const progress = await patchPartProgress(partId, unitIndex, completed);
        setReview((r) =>
          r
            ? mergeProgressIntoReview(r, partId, {
                printed_count: progress.printed_count,
                print_units: progress.print_units,
                missing: progress.missing,
              })
            : r,
        );
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        if (profileIdRef.current != null) await reload(profileIdRef.current);
      } finally {
        setBusyPartId(null);
      }
    },
    [review, reload],
  );

  const value = useMemo(
    (): PlanWorkspaceValue => ({
      review,
      loading,
      error,
      revision,
      loadedRevision,
      progressSummary: summaryFromReview(review),
      reload,
      invalidate,
      bumpPlanRevision: invalidate,
      setQuantity,
      setIncluded,
      toggleUnit,
      busyPartId,
    }),
    [
      review,
      loading,
      error,
      revision,
      loadedRevision,
      reload,
      invalidate,
      setQuantity,
      setIncluded,
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

export function usePlanRevisionBump(): () => void {
  const ctx = useContext(PlanWorkspaceContext);
  return ctx?.invalidate ?? (() => {});
}

/** Refetch review when entering Review if build revision changed since last load. */
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
