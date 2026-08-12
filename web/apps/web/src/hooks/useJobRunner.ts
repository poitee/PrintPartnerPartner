import { useCallback, useState } from "react";
import { useJobContext } from "../context/JobContext";
import type { JobSnapshot } from "../api/engine";

export function useJobRunner(kind = "job") {
  const { activeJobs, isJobKindRunning, runJob: runContextJob } = useJobContext();
  const [localMessage, setLocalMessage] = useState("");

  const jobForKind = activeJobs.find((j) => j.kind === kind);
  const busy = isJobKindRunning(kind);

  const message =
    jobForKind?.message ||
    localMessage ||
    (jobForKind ? `${jobForKind.status}` : "");

  const runJob = useCallback(
    async (
      start: () => Promise<string>,
      onDone?: (snapshot: JobSnapshot) => void,
      options?: { profileId?: number | null; sourceIds?: number[] },
    ) => {
      setLocalMessage("");
      await runContextJob(kind, start, onDone, options);
    },
    [kind, runContextJob],
  );

  return { busy, message, runJob };
}
