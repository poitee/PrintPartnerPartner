import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import PageHeader from "../components/layout/PageHeader";
import PageHeaderActions from "../components/layout/PageHeaderActions";
import RouteBreadcrumbs from "../components/layout/RouteBreadcrumbs";
import ShareBuildExportDialog from "../components/share/ShareBuildExportDialog";
import ReviewPartsSheet from "../components/review/ReviewPartsSheet";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Card, CardContent } from "../components/ui/card";
import { startExportStlPack } from "../api/engine";
import { buildRoute, checkoffRoute, sourcesRoute } from "../lib/routes";
import { completeExportDownload } from "../lib/exportActions";
import { useProfileSelection } from "../context/ProfileContext";
import { usePlanWorkspace } from "../context/PlanWorkspaceContext";
import { useEngineHealth } from "../hooks/useEngineHealth";
import { useJobRunner } from "../hooks/useJobRunner";

function hintRoute(hint: string | null | undefined, profileId: number | null) {
  if (hint === "sources") return sourcesRoute();
  if (hint === "build" && profileId != null) return buildRoute(profileId);
  return null;
}

export default function ReviewPage() {
  const { health, error: engineError } = useEngineHealth();
  const { selectedProfileId, profiles } = useProfileSelection();
  const {
    review,
    loading,
    error: workspaceError,
    reload,
    revision,
    loadedRevision,
  } = usePlanWorkspace();
  const exportStlJob = useJobRunner("stl-export");
  const [shareOpen, setShareOpen] = useState(false);

  useEffect(() => {
    if (!health?.ok || selectedProfileId == null) return;
    if (review?.profile_id !== selectedProfileId || loadedRevision < revision) {
      void reload(selectedProfileId);
    }
  }, [health?.ok, selectedProfileId, revision, loadedRevision, reload, review?.profile_id]);

  const loadError = workspaceError;
  const planName =
    review?.plan_name ??
    profiles.find((p) => p.id === selectedProfileId)?.name ??
    "Review";

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
        completeExportDownload("STL export", snap.result, { pathField: "root_path" });
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
        description="Validate parts, edit quantities, and export before shop-floor checkoff."
        actions={
          <PageHeaderActions>
            <Button
              className="min-h-10 w-full sm:w-auto"
              onClick={onExportStls}
              disabled={
                selectedProfileId == null || hasBlockers || exportStlJob.busy || !health
              }
            >
              {exportStlJob.busy ? "Exporting…" : "Export STLs"}
            </Button>
            <Button
              variant="secondary"
              className="min-h-10 w-full sm:w-auto"
              onClick={() => setShareOpen(true)}
              disabled={selectedProfileId == null}
            >
              Share build…
            </Button>
          </PageHeaderActions>
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
              Select a plan in the header to review sync status and parts before export.
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

          <ReviewPartsSheet
            review={review}
            planName={planName}
            disabled={!health || loading}
          />

          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
            <Button className="min-h-10 w-full sm:w-auto" variant="ghost" asChild>
              <Link to={buildRoute(selectedProfileId)}>Back to Build</Link>
            </Button>
            <Button className="min-h-10 w-full sm:w-auto" asChild>
              <Link to={checkoffRoute(selectedProfileId)}>Continue to Checkoff</Link>
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
