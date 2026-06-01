import { Loader2 } from "lucide-react";
import { useJobContext } from "../context/JobContext";
import { jobKindLabel } from "../lib/jobLabels";
import { cn } from "../lib/utils";

const STATUS_STYLES: Record<string, string> = {
  pending: "text-amber-400",
  running: "text-sky-400",
  done: "text-emerald-400",
  error: "text-red-400",
  cancelled: "text-muted-foreground",
};

export default function JobTray() {
  const { activeJob } = useJobContext();
  if (!activeJob) return null;

  const pct =
    activeJob.progress != null
      ? Math.round(Math.min(100, Math.max(0, activeJob.progress * 100)))
      : null;
  const isActive = activeJob.status === "pending" || activeJob.status === "running";
  const statusClass = STATUS_STYLES[activeJob.status] ?? "text-muted-foreground";

  return (
    <footer
      className="job-tray fixed bottom-0 left-56 right-0 z-50 border-t border-border bg-card/95 backdrop-blur-sm"
      role="status"
      aria-live="polite"
      aria-label={`${jobKindLabel(activeJob.kind)}: ${activeJob.message}`}
    >
      <div className="flex items-center gap-3 px-5 py-2.5 text-sm">
        {isActive ? (
          <Loader2 className="h-4 w-4 shrink-0 animate-spin text-primary" aria-hidden />
        ) : null}
        <span className="shrink-0 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {jobKindLabel(activeJob.kind)}
        </span>
        <span className="min-w-0 flex-1 truncate text-foreground">{activeJob.message}</span>
        {pct != null ? (
          <span className="shrink-0 tabular-nums text-xs text-primary">{pct}%</span>
        ) : null}
        <span className={cn("shrink-0 text-xs capitalize", statusClass)}>
          {activeJob.status}
        </span>
      </div>
      {pct != null && isActive ? (
        <div
          className="h-0.5 bg-primary/20"
          role="progressbar"
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <div
            className="h-full bg-primary transition-[width] duration-200 ease-out"
            style={{ width: `${pct}%` }}
          />
        </div>
      ) : null}
    </footer>
  );
}
