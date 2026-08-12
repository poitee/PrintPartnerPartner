import { Loader2 } from "lucide-react";
import { useJobContext } from "../../context/JobContext";
import { jobKindLabel } from "../../lib/jobLabels";
import { cn } from "../../lib/utils";

export const EXPORT_JOB_KINDS = new Set([
  "stl-export",
  "export",
  "export-3mf",
  "kit-export",
  "export-checklist-html",
  "export-kit-bundle",
]);

export function hasExportJobs(jobs: { kind: string }[]): boolean {
  return jobs.some((j) => EXPORT_JOB_KINDS.has(j.kind));
}

/**
 * Recent / in-flight export jobs from JobContext.
 * Returns null when nothing to show (no persistent export history store).
 */
export default function ExportRecentPanel() {
  const { activeJobs } = useJobContext();
  const exportJobs = activeJobs
    .filter((j) => EXPORT_JOB_KINDS.has(j.kind))
    .slice()
    .reverse();

  if (exportJobs.length === 0) return null;

  return (
    <aside className="flex flex-col gap-3 rounded-lg border border-border bg-card p-3.5 shadow-sm">
      <span className="font-mono text-[9.5px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
        Recent
      </span>
      <ul className="flex flex-col gap-0">
        {exportJobs.map((job, idx) => {
          const isActive = job.status === "pending" || job.status === "running";
          const pct =
            job.progress != null
              ? Math.round(Math.min(100, Math.max(0, job.progress * 100)))
              : null;
          return (
            <li
              key={job.jobId || `${job.kind}-${idx}`}
              className="flex flex-col gap-1 border-b border-border/60 py-2.5 last:border-b-0 last:pb-0 first:pt-0"
            >
              <span className="text-[12.5px] font-semibold leading-snug">
                {jobKindLabel(job.kind)}
              </span>
              {isActive ? (
                <div className="flex flex-col gap-1.5 rounded-md border border-sky-300/60 bg-sky-50 p-2.5 dark:border-sky-800/50 dark:bg-sky-950/40">
                  <div className="flex items-center gap-1.5">
                    <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-sky-600 dark:text-sky-400" />
                    <span className="truncate font-mono text-[10.5px] text-sky-700 dark:text-sky-300">
                      {job.message || job.status}
                    </span>
                  </div>
                  {pct != null ? (
                    <span
                      className="block h-1 overflow-hidden rounded-full bg-sky-200/80 dark:bg-sky-900"
                      role="progressbar"
                      aria-valuenow={pct}
                      aria-valuemin={0}
                      aria-valuemax={100}
                    >
                      <span
                        className="block h-full bg-sky-600 transition-[width] duration-200 dark:bg-sky-400"
                        style={{ width: `${pct}%` }}
                      />
                    </span>
                  ) : null}
                </div>
              ) : (
                <span
                  className={cn(
                    "font-mono text-[10.5px] text-muted-foreground",
                    job.status === "error" && "text-destructive",
                  )}
                >
                  {job.status}
                  {job.message ? ` · ${job.message}` : ""}
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </aside>
  );
}
