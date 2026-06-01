import { Link } from "react-router-dom";
import { Button } from "../ui/button";
import { buildRoute, sourcesRoute } from "../../lib/routes";

export type UnmatchedSource = {
  name: string;
  url: string;
  branch: string;
  source_kind: string;
  role: string;
  import_rules: string[];
};

type Props = {
  unmatchedSources: UnmatchedSource[];
  warnings: string[];
  profileId: number | null;
  onDismiss?: () => void;
};

export default function ShareImportSetupPanel({
  unmatchedSources,
  warnings,
  profileId,
  onDismiss,
}: Props) {
  if (unmatchedSources.length === 0 && warnings.length === 0) return null;

  return (
    <section className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-4 space-y-3">
      <h3 className="text-sm font-semibold">Share import setup</h3>
      {unmatchedSources.length > 0 && (
        <div>
          <p className="mb-2 text-sm text-muted-foreground">
            Add these repos on Sources, sync them, then run <strong>Update build</strong> on
            Build and check Review.
          </p>
          <ul className="space-y-2 text-sm">
            {unmatchedSources.map((s) => (
              <li key={`${s.url}-${s.name}`} className="rounded-md border border-border bg-card p-2">
                <p className="font-medium">{s.name || s.url}</p>
                {s.url && (
                  <p className="text-xs text-muted-foreground truncate">{s.url}</p>
                )}
                {s.import_rules.length > 0 && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    Suggested import: {s.import_rules.join(", ")}
                  </p>
                )}
              </li>
            ))}
          </ul>
          <Button size="sm" variant="secondary" className="mt-2" asChild>
            <Link to={sourcesRoute()}>Go to Sources</Link>
          </Button>
        </div>
      )}
      {warnings.length > 0 && (
        <ul className="space-y-1 text-xs text-muted-foreground">
          {warnings.map((w, i) => (
            <li key={i}>{w}</li>
          ))}
        </ul>
      )}
      {profileId != null && (
        <Button size="sm" asChild>
          <Link to={buildRoute(profileId)}>Open Build</Link>
        </Button>
      )}
      {onDismiss && (
        <Button size="sm" variant="ghost" onClick={onDismiss}>
          Dismiss
        </Button>
      )}
    </section>
  );
}
