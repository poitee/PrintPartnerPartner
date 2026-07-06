import { AlertTriangle, RefreshCw } from "lucide-react";
import { Button } from "./ui/button";
import { cn } from "../lib/utils";

type Props = {
  stale: boolean;
  busy?: boolean;
  onUpdate: () => void;
  className?: string;
};

/** Persistent banner when plan config changed since last recompute. */
export default function StaleBuildBanner({ stale, busy, onUpdate, className }: Props) {
  if (!stale) return null;

  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm print:hidden",
        className,
      )}
      role="status"
    >
      <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden />
      <span className="min-w-0 flex-1 text-foreground">
        Build out of date — Review and Checkoff may not reflect your latest file picks or colors.
      </span>
      <Button type="button" size="sm" variant="secondary" disabled={busy} onClick={onUpdate}>
        <RefreshCw className={cn("mr-1.5 h-3.5 w-3.5", busy && "animate-spin")} aria-hidden />
        {busy ? "Updating…" : "Update build"}
      </Button>
    </div>
  );
}
