import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import PageHeader from "../components/layout/PageHeader";
import RouteBreadcrumbs from "../components/layout/RouteBreadcrumbs";
import ShareBuildExportDialog from "../components/share/ShareBuildExportDialog";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import {
  Card,
  CardContent,
} from "../components/ui/card";
import ReviewPartsEditor from "../components/review/ReviewPartsEditor";
import { downloadExport, fetchPlanReview, startExportStlPack, type PlanReview } from "../api/engine";
import { buildRoute, checkoffRoute, sourcesRoute } from "../lib/routes";
import { notifyExportComplete } from "../lib/exportActions";
import { toast } from "sonner";
import { useProfileSelection } from "../context/ProfileContext";
import { useEngineHealth } from "../hooks/useEngineHealth";
import { useJobRunner } from "../hooks/useJobRunner";

function hintRoute(hint: string | null | undefined, profileId: number | null) {
  if (hint === "sources") return sourcesRoute();
  if (hint === "build" && profileId != null) return buildRoute(profileId);
  return null;
}

export default function ReviewPage() {
  const { health, error: engineError } = useEngineHealth();
  const { selectedProfileId } = useProfileSelection();
  const exportStlJob = useJobRunner("stl-export");
  const [review, setReview] = useState<PlanReview | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);

  const load = useCallback(async (profileId: number) => {
    setLoadError(null);
    setLoading(true);
    try {
      setReview(await fetchPlanReview(profileId));
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setLoadError(
        message.includes("404")
          ? "Plan review API is unavailable — restart the Print Partner engine, then try again."
          : message,
      );
      setReview(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!health || selectedProfileId == null) {
      setReview(null);
      setLoadError(null);
      setLoading(false);
      return;
    }
    void load(selectedProfileId);
  }, [health, selectedProfileId, load]);

  const blockers = useMemo(
    () => review?.issues.filter((i) => i.severity === "blocker") ?? [],
    [review],
  );
  const warnings = useMemo(
    () => review?.issues.filter((i) => i.severity === "warning") ?? [],
    [review],
  );

  const hasBlockers = review?.has_blockers ?? blockers.length > 0;

  const onExportStls = () => {
    if (selectedProfileId == null) return;
    void exportStlJob.runJob(
      () => startExportStlPack(selectedProfileId),
      (snap) => {
        if (snap.status === "error") {
          toast.error(snap.message || "STL export failed");
          return;
        }
        const downloadUrl = snap.result?.download_url;
        const root = snap.result?.root_path;
        if (typeof downloadUrl === "string") {
          downloadExport(downloadUrl);
          toast.success("STL pack downloaded");
        } else if (typeof root === "string") {
          notifyExportComplete("STL export", root);
        }
      },
    );
  };

  return (
    <div className="space-y-4">
      <RouteBreadcrumbs
        items={[
          { label: "Build", to: buildRoute(selectedProfileId) },
          { label: "Review" },
        ]}
      />
      <PageHeader
        title="Review"
        description="Confirm parts, quantities, and sources before exporting STLs."
        actions={
          <>
            <Button
              onClick={onExportStls}
              disabled={selectedProfileId == null || hasBlockers || exportStlJob.busy || !health}
            >
              {exportStlJob.busy ? "Exporting…" : "Export STLs"}
            </Button>
            <Button variant="secondary" onClick={() => setShareOpen(true)} disabled={selectedProfileId == null}>
              Share build…
            </Button>
          </>
        }
      />

      {loadError && <p className="text-sm text-destructive">{loadError}</p>}

      {!health ? (
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">
              {engineError
                ? "Engine offline — start the print-partner engine to review this plan."
                : "Connecting to the engine…"}
            </p>
          </CardContent>
        </Card>
      ) : selectedProfileId == null ? (
        <Card>
          <CardContent className="space-y-3 pt-6">
            <p className="text-sm text-muted-foreground">
              Select a plan in the header to review sync status and blockers before export.
            </p>
            <Button variant="secondary" size="sm" asChild>
              <Link to={buildRoute(null)}>Go to Build</Link>
            </Button>
          </CardContent>
        </Card>
      ) : loading && !review ? (
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">Loading plan review…</p>
          </CardContent>
        </Card>
      ) : review ? (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {[
              ["Included parts", String(review.totals.included_parts)],
              ["Print units", String(review.totals.total_print_units)],
              [
                "By role",
                Object.entries(review.totals.by_role)
                  .map(([k, v]) => `${k}: ${v}`)
                  .join(", ") || "—",
              ],
              [
                "Filaments",
                Object.entries(review.totals.by_filament)
                  .map(([k, v]) => `${k}: ${v}`)
                  .join(", ") || "—",
              ],
            ].map(([label, value]) => (
              <div key={label} className="rounded-lg border border-border bg-card p-3">
                <p className="text-xs text-muted-foreground">{label}</p>
                <p className="text-lg font-semibold">{value}</p>
              </div>
            ))}
          </div>

          <section className="rounded-lg border border-border bg-card p-4">
            <h3 className="mb-2 text-sm font-semibold">Sources</h3>
            <ul className="space-y-2 text-sm">
              {review.layers.map((layer) => (
                <li key={layer.id} className="flex flex-wrap items-center gap-2">
                  <Badge variant={layer.layer_type === "base" ? "base" : "addon"}>
                    {layer.layer_type}
                  </Badge>
                  <span>{layer.project_name ?? "—"}</span>
                  {layer.synced ? (
                    <Badge variant="muted">synced</Badge>
                  ) : (
                    <Badge variant="muted" className="border-amber-500/50 text-amber-600">
                      not synced
                    </Badge>
                  )}
                </li>
              ))}
            </ul>
          </section>

          {(blockers.length > 0 || warnings.length > 0) && (
            <section className="rounded-lg border border-border bg-card p-4 space-y-3">
              <h3 className="text-sm font-semibold">Issues</h3>
              {blockers.map((issue, i) => (
                <div
                  key={`b-${i}`}
                  className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm"
                >
                  <p>{issue.message}</p>
                  {issue.link_hint && hintRoute(issue.link_hint, selectedProfileId) && (
                    <Link
                      to={hintRoute(issue.link_hint, selectedProfileId)!}
                      className="mt-1 inline-block text-xs text-primary underline"
                    >
                      {issue.link_hint === "sources" ? "Go to Sources" : "Go to Build"}
                    </Link>
                  )}
                </div>
              ))}
              {warnings.map((issue, i) => (
                <div
                  key={`w-${i}`}
                  className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm"
                >
                  {issue.message}
                </div>
              ))}
            </section>
          )}

          <ReviewPartsEditor
            review={review}
            disabled={!health || loading}
            onReviewUpdated={setReview}
            onReload={async () => {
              if (selectedProfileId != null) await load(selectedProfileId);
            }}
          />

          <div className="flex flex-wrap gap-2">
            <Button asChild disabled={hasBlockers}>
              <Link to={checkoffRoute(selectedProfileId)}>Continue to Checkoff</Link>
            </Button>
            <Button variant="ghost" asChild>
              <Link to={buildRoute(selectedProfileId)}>Back to Build</Link>
            </Button>
          </div>
        </>
      ) : null}

      {selectedProfileId != null && (
        <ShareBuildExportDialog
          open={shareOpen}
          onOpenChange={setShareOpen}
          profileId={selectedProfileId}
        />
      )}
    </div>
  );
}
