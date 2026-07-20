import { useEffect, useRef } from "react";
import { startRecompute } from "../api/engine";
import { useJobRunner } from "./useJobRunner";

const AUTO_RECOMPUTE_DEBOUNCE_MS = 3000;

type Options = {
  profileId: number | null;
  stale: boolean;
  enabled: boolean;
  onDone?: () => void;
  beforeRecompute?: () => Promise<void>;
};

/** Debounced auto-recompute when plan is stale and setting is enabled. */
export function useAutoRecompute({
  profileId,
  stale,
  enabled,
  onDone,
  beforeRecompute,
}: Options) {
  const { busy, runJob } = useJobRunner("recompute");
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ranForStaleRef = useRef(false);

  useEffect(() => {
    if (!enabled || !stale || profileId == null || busy) return;
    if (ranForStaleRef.current) return;

    timerRef.current = setTimeout(() => {
      ranForStaleRef.current = true;
      void (async () => {
        try {
          await beforeRecompute?.();
        } catch {
          ranForStaleRef.current = false;
          return;
        }
        void runJob(
          () => startRecompute(profileId, { apply_manifest: true }),
          (snap) => {
            if (snap.status === "done") onDone?.();
            ranForStaleRef.current = false;
          },
          { profileId },
        );
      })();
    }, AUTO_RECOMPUTE_DEBOUNCE_MS);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [enabled, stale, profileId, busy, runJob, onDone, beforeRecompute]);

  useEffect(() => {
    if (!stale) ranForStaleRef.current = false;
  }, [stale]);
}
