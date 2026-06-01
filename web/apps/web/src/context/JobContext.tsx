import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  connectJobWebSocket,
  fetchJob,
  type JobEvent,
  type JobSnapshot,
} from "../api/engine";

export type ActiveJob = {
  jobId: string;
  kind: string;
  status: string;
  message: string;
  progress: number | null;
};

type JobContextValue = {
  activeJob: ActiveJob | null;
  runJob: (
    kind: string,
    start: () => Promise<string>,
    onDone?: (snapshot: JobSnapshot) => void,
  ) => Promise<void>;
  clearJob: () => void;
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

export function JobProvider({ children }: { children: ReactNode }) {
  const [activeJob, setActiveJob] = useState<ActiveJob | null>(null);

  const clearJob = useCallback(() => {
    setActiveJob(null);
  }, []);

  const runJob = useCallback(
    async (
      kind: string,
      start: () => Promise<string>,
      onDone?: (snapshot: JobSnapshot) => void,
    ) => {
      let disconnect: (() => void) | null = null;
      let finished = false;
      try {
        const jobId = await start();
        setActiveJob({
          jobId,
          kind,
          status: "pending",
          message: "Starting…",
          progress: null,
        });

        const finish = (snap: JobSnapshot) => {
          if (finished) return;
          finished = true;
          disconnect?.();
          onDone?.(snap);
          setActiveJob({
            jobId,
            kind,
            status: snap.status,
            message: snap.message,
            progress: snap.progress,
          });
          setTimeout(() => setActiveJob(null), 2500);
        };

        const onProgress = (ev: JobEvent | JobSnapshot) => {
          setActiveJob({
            jobId,
            kind,
            status: ev.status,
            message: ev.message,
            progress: ev.progress,
          });
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
          setActiveJob({
            jobId,
            kind,
            status: "error",
            message: e instanceof Error ? e.message : String(e),
            progress: null,
          });
        });
      } catch (e) {
        setActiveJob({
          jobId: "",
          kind,
          status: "error",
          message: e instanceof Error ? e.message : String(e),
          progress: null,
        });
      }
    },
    [],
  );

  const value = useMemo(
    () => ({ activeJob, runJob, clearJob }),
    [activeJob, runJob, clearJob],
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
