import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import {
  AlertTriangle,
  Box,
  ChevronDown,
  ClipboardCheck,
  Hash,
  Layers,
  Palette,
  RefreshCw,
  XCircle,
} from "lucide-react";
import PageHeader from "../components/layout/PageHeader";
import PageHeaderActions from "../components/layout/PageHeaderActions";
import RouteBreadcrumbs from "../components/layout/RouteBreadcrumbs";
import ShareBuildExportDialog from "../components/share/ShareBuildExportDialog";
import ReviewPartsSheet from "../components/review/ReviewPartsSheet";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../components/ui/dropdown-menu";
import { Card, CardContent } from "../components/ui/card";
import { startExportStlPack, type StlPackGroupBy } from "../api/engine";
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

  const onExportStls = (groupBy: StlPackGroupBy) => {
    if (selectedProfileId == null) return;
    void exportStlJob.runJob(
      () => startExportStlPack(selectedProfileId, { group_by: groupBy }),
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
        icon={ClipboardCheck}
        accent
        title="Review"
        description="Validate parts, edit quantities, and export before shop-floor checkoff."
        actions={
          <PageHeaderActions>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  className="min-h-10 w-full sm:w-auto"
                  disabled={
                    selectedProfileId == null || hasBlockers || exportStlJob.busy || !health
                  }
                >
                  {exportStlJob.busy ? "Exporting…" : "Export STLs"}
                  <ChevronDown className="ml-1 h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-64">
                <DropdownMenuLabel>Group exported files by</DropdownMenuLabel>
                <DropdownMenuItem onClick={() => onExportStls("color_dir")}>
                  <div className="flex flex-col">
                    <span>Color + directory</span>
                    <span className="text-xs text-muted-foreground">
                      Keep source folders (e.g. Primary/partsDir/file.stl)
                    </span>
                  </div>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => onExportStls("color")}>
                  <div className="flex flex-col">
                    <span>Color only</span>
                    <span className="text-xs text-muted-foreground">
                      Flatten all directories (e.g. Primary/file.stl)
                    </span>
                  </div>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
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
            {(
              [
                { label: "Included parts", value: String(review.totals.included_parts), icon: Box },
                { label: "Print units", value: String(review.totals.total_print_units), icon: Hash },
                {
                  label: "By role",
                  value:
                    Object.entries(review.totals.by_role)
                      .map(([k, v]) => `${k}: ${v}`)
                      .join(", ") || "—",
                  icon: Layers,
                },
                {
                  label: "Filaments",
                  value:
                    Object.entries(review.totals.by_filament)
                      .map(([k, v]) => `${k}: ${v}`)
                      .join(", ") || "—",
                  icon: Palette,
                },
              ] as const
            ).map(({ label, value, icon: StatIcon }) => (
              <div key={label} className="stat-tile">
                <div className="mb-2 flex items-center gap-2">
                  <span className="flex h-7 w-7 items-center justify-center rounded-md bg-accent-brand/10 text-accent-brand">
                    <StatIcon className="h-3.5 w-3.5" aria-hidden />
                  </span>
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    {label}
                  </p>
                </div>
                <p className="text-lg font-semibold tabular">{value}</p>
              </div>
            ))}
          </div>

          <section className="section-card">
            <h3 className="mb-2 text-sm font-semibold">Sources</h3>
            <ul className="space-y-2 text-sm">
              {review.layers.map((layer) => (
                <li key={layer.id} className="flex flex-wrap items-center gap-2">
                  <Badge
                    variant={layer.layer_type === "base" ? "base" : "addon"}
                    icon={layer.layer_type === "base" ? Layers : Box}
                  >
                    {layer.layer_type}
                  </Badge>
                  <span>{layer.project_name ?? "—"}</span>
                  {layer.synced ? (
                    <Badge variant="success" icon={RefreshCw}>
                      synced
                    </Badge>
                  ) : (
                    <Badge variant="warning" icon={AlertTriangle}>
                      not synced
                    </Badge>
                  )}
                </li>
              ))}
            </ul>
          </section>

          {(blockers.length > 0 || warnings.length > 0) && (
            <section className="section-card space-y-3">
              <h3 className="text-sm font-semibold">Issues</h3>
              {blockers.map((issue, i) => (
                <div
                  key={`b-${i}`}
                  className="flex gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm"
                >
                  <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-hidden />
                  <div>
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
                </div>
              ))}
              {warnings.map((issue, i) => (
                <div
                  key={`w-${i}`}
                  className="flex gap-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm"
                >
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden />
                  <div>
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
