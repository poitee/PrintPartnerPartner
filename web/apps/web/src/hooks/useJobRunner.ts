import { useCallback, useState } from "react";
import { useJobContext } from "../context/JobContext";
import type { JobSnapshot } from "../api/engine";

export function useJobRunner(kind = "job") {
  const { activeJob, runJob: runContextJob } = useJobContext();
  const [localMessage, setLocalMessage] = useState("");

  const busy =
    activeJob != null &&
    !["done", "error", "cancelled"].includes(activeJob.status);

  const message =
    activeJob?.message ||
    localMessage ||
    (activeJob ? `${activeJob.status}` : "");

  const runJob = useCallback(
    async (
      start: () => Promise<string>,
      onDone?: (snapshot: JobSnapshot) => void,
    ) => {
      setLocalMessage("");
      await runContextJob(kind, start, onDone);
    },
    [kind, runContextJob],
  );

  return { busy, message, runJob };
}
