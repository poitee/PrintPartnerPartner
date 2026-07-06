import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  connectJobWebSocket,
  fetchJob,
  type JobEvent,
  type JobSnapshot,
} from "../api/engine";
import { invalidateAfterJob } from "../queries/invalidation";

export type ActiveJob = {
  jobId: string;
  kind: string;
  status: string;
  message: string;
  progress: number | null;
};

type JobContextValue = {
  /** All in-flight or recently finished jobs (most recent last). */
  activeJobs: ActiveJob[];
  /** @deprecated Use activeJobs — first active job for backward compat. */
  activeJob: ActiveJob | null;
  runJob: (
    kind: string,
    start: () => Promise<string>,
    onDone?: (snapshot: JobSnapshot) => void,
    options?: { profileId?: number | null },
  ) => Promise<void>;
  clearJob: (jobId?: string) => void;
  isJobKindRunning: (kind: string) => boolean;
};

const JobContext = createContext<JobContextValue | null>(null);

const JOB_TERMINAL = new Set(["done", "error", "cancelled"]);

async function pollJobUntilTerminal(
  jobId: string,
  onProgress: (snap: JobSnapshot) => void,
  intervalMs = 400,
  maxAttempts = 150,
): Promise<JobSnapshot> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const snap = await fetchJob(jobId);
    onProgress(snap);
    if (JOB_TERMINAL.has(snap.status)) return snap;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error("Job timed out waiting for completion");
}

function upsertJob(jobs: ActiveJob[], next: ActiveJob): ActiveJob[] {
  const idx = jobs.findIndex((j) => j.jobId === next.jobId);
  if (idx >= 0) {
    const copy = [...jobs];
    copy[idx] = next;
    return copy;
  }
  return [...jobs, next];
}

export function JobProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const [activeJobs, setActiveJobs] = useState<ActiveJob[]>([]);

  const clearJob = useCallback((jobId?: string) => {
    if (jobId) {
      setActiveJobs((prev) => prev.filter((j) => j.jobId !== jobId));
    } else {
      setActiveJobs([]);
    }
  }, []);

  const isJobKindRunning = useCallback(
    (kind: string) =>
      activeJobs.some(
        (j) =>
          j.kind === kind &&
          (j.status === "pending" || j.status === "running"),
      ),
    [activeJobs],
  );

  const runJob = useCallback(
    async (
      kind: string,
      start: () => Promise<string>,
      onDone?: (snapshot: JobSnapshot) => void,
      options?: { profileId?: number | null },
    ) => {
      let disconnect: (() => void) | null = null;
      let finished = false;
      try {
        const jobId = await start();
        const initial: ActiveJob = {
          jobId,
          kind,
          status: "pending",
          message: "Starting…",
          progress: null,
        };
        setActiveJobs((prev) => upsertJob(prev, initial));

        const finish = (snap: JobSnapshot) => {
          if (finished) return;
          finished = true;
          disconnect?.();
          onDone?.(snap);
          invalidateAfterJob(qc, kind, snap, options?.profileId);
          setActiveJobs((prev) =>
            upsertJob(prev, {
              jobId,
              kind,
              status: snap.status,
              message: snap.message,
              progress: snap.progress,
            }),
          );
          setTimeout(() => {
            setActiveJobs((prev) => prev.filter((j) => j.jobId !== jobId));
          }, 2500);
        };

        const onProgress = (ev: JobEvent | JobSnapshot) => {
          setActiveJobs((prev) =>
            upsertJob(prev, {
              jobId,
              kind,
              status: ev.status,
              message: ev.message,
              progress: ev.progress,
            }),
          );
          if (JOB_TERMINAL.has(ev.status)) {
            void fetchJob(jobId).then(finish).catch(() => finish(ev as JobSnapshot));
          }
        };

        disconnect = connectJobWebSocket(
          jobId,
          onProgress,
          () => {
            /* WebSocket unavailable — HTTP polling fallback handles completion */
          },
        );

        void pollJobUntilTerminal(jobId, onProgress).catch((e) => {
          if (finished) return;
          finished = true;
          disconnect?.();
          setActiveJobs((prev) =>
            upsertJob(prev, {
              jobId,
              kind,
              status: "error",
              message: e instanceof Error ? e.message : String(e),
              progress: null,
            }),
          );
        });
      } catch (e) {
        setActiveJobs((prev) =>
          upsertJob(prev, {
            jobId: "",
            kind,
            status: "error",
            message: e instanceof Error ? e.message : String(e),
            progress: null,
          }),
        );
      }
    },
    [qc],
  );

  const activeJob = activeJobs.find(
    (j) => j.status === "pending" || j.status === "running",
  ) ?? activeJobs[activeJobs.length - 1] ?? null;

  const value = useMemo(
    () => ({ activeJobs, activeJob, runJob, clearJob, isJobKindRunning }),
    [activeJobs, activeJob, runJob, clearJob, isJobKindRunning],
  );

  return <JobContext.Provider value={value}>{children}</JobContext.Provider>;
}

export function useJobContext() {
  const ctx = useContext(JobContext);
  if (!ctx) {
    throw new Error("useJobContext must be used within JobProvider");
  }
  return ctx;
}
