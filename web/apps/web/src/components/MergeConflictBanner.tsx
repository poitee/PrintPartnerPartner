import { AlertTriangle } from "lucide-react";
import { Link } from "react-router-dom";
import { reviewRoute } from "../lib/routes";
import { cn } from "../lib/utils";

type Props = {
  conflictCount: number;
  /** Unique filenames with variant counts, e.g. [["widget.stl", 2]] */
  groupedByFilename?: Array<[string, number]>;
  profileId: number | null;
  className?: string;
};

export default function MergeConflictBanner({
  conflictCount,
  groupedByFilename,
  profileId,
  className,
}: Props) {
  if (conflictCount === 0) return null;

  const groups = groupedByFilename ?? [];
  const showGroups = groups.length > 0 && groups.length <= 6;

  return (
    <div
      className={cn(
        "flex gap-2 rounded-md border border-warning bg-warning/15 px-3 py-2.5 text-sm",
        className,
      )}
      role="alert"
    >
      <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-warning" aria-hidden />
      <div className="min-w-0">
        <p className="font-medium">
          Duplicate part names ({conflictCount} conflict{conflictCount === 1 ? "" : "s"})
        </p>
        <p className="mt-1 text-muted-foreground">
          Overlapping import rules or addon layers can import the same part slug twice. Narrow
          import rules or exclude extras on Review.
        </p>
        {showGroups && (
          <ul className="mt-2 space-y-0.5 text-xs text-muted-foreground">
            {groups.map(([filename, count]) => (
              <li key={filename}>
                <span className="font-mono text-foreground">{filename}</span>
                {" — "}
                {count} variant{count === 1 ? "" : "s"}
              </li>
            ))}
          </ul>
        )}
        {profileId != null && (
          <Link
            to={reviewRoute(profileId)}
            className="mt-2 inline-block text-xs text-primary underline"
          >
            Resolve on Review
          </Link>
        )}
      </div>
    </div>
  );
}
