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
import StaleBuildBanner from "../components/StaleBuildBanner";
import EmptyState from "../components/layout/EmptyState";
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
import { startExportStlPack, startRecompute, startSync, type StlPackGroupBy } from "../api/engine";
import { buildRoute, checkoffRoute, sourcesRoute } from "../lib/routes";
import { handleStlPackExportJobDone } from "../lib/exportStlJobResult";
import { groupMergeConflictsByFilename } from "../lib/mergeConflictGroups";
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
  const recomputeJob = useJobRunner("recompute");
  const syncJob = useJobRunner("sync");
  const [shareOpen, setShareOpen] = useState(false);

  const selectedProfile = profiles.find((p) => p.id === selectedProfileId);
  const buildStale = selectedProfile?.build_stale ?? false;

  const onUpdateBuild = () => {
    if (selectedProfileId == null) return;
    void recomputeJob.runJob(
      () => startRecompute(selectedProfileId, { apply_manifest: true }),
      (snap) => {
        if (snap.status === "error") toast.error(snap.message || "Update failed");
      },
      { profileId: selectedProfileId },
    );
  };

  const syncUnsyncedLayers = () => {
    const unsynced = review?.layers.filter((l) => !l.synced && l.project_id != null) ?? [];
    const ids = [...new Set(unsynced.map((l) => l.project_id!).filter(Boolean))];
    if (ids.length === 0) return;
    void syncJob.runJob(
      () => startSync(ids),
      (snap) => {
        if (snap.status === "error") {
          toast.error(snap.message || "Sync failed");
          return;
        }
        if (selectedProfileId != null) void reload(selectedProfileId);
      },
    );
  };

  useEffect(() => {
    if (!health?.ok || selectedProfileId == null) return;
    if (review?.profile_id !== selectedProfileId || loadedRevision < revision) {
      void reload(selectedProfileId);
    }
  }, [health?.ok, selectedProfileId, revision, loadedRevision, reload, review?.profile_id]);

  const loadError = workspaceError;
  const planName =
    profiles.find((p) => p.id === selectedProfileId)?.name ??
    review?.plan_name ??
    "Review";

  const blockers = useMemo(
    () => review?.issues.filter((i) => i.severity === "blocker") ?? [],
    [review],
  );
  const warnings = useMemo(
    () => review?.issues.filter((i) => i.severity === "warning") ?? [],
    [review],
  );
  const mergeConflicts = useMemo(
    () => review?.issues.filter((i) => i.code === "merge_conflict") ?? [],
    [review],
  );
  const mergeConflictGroups = useMemo(
    () => groupMergeConflictsByFilename(mergeConflicts),
    [mergeConflicts],
  );
  const hasBlockers = review?.has_blockers ?? blockers.length > 0;

  const onExportStls = (groupBy: StlPackGroupBy) => {
    if (selectedProfileId == null) return;
    void exportStlJob.runJob(
      () => startExportStlPack(selectedProfileId, { group_by: groupBy }),
      (snap) => {
        handleStlPackExportJobDone("STL export", snap, { pathField: "root_path" });
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

      <StaleBuildBanner
        stale={buildStale}
        busy={recomputeJob.busy}
        onUpdate={onUpdateBuild}
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
        <EmptyState
          icon={ClipboardCheck}
          title="No plan selected"
          description="Choose a plan in the header or create one to review parts and export STLs."
        />
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

          {(mergeConflicts.length > 0 || blockers.length > 0 || warnings.length > 0) && (
            <section className="section-card space-y-3">
              <h3 className="text-sm font-semibold">Issues</h3>
              {mergeConflicts.length > 0 && (
                <div
                  className="flex gap-2 rounded-md border border-warning bg-warning/15 px-3 py-2.5 text-sm"
                  role="alert"
                >
                  <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-warning" aria-hidden />
                  <div>
                    <p className="font-medium">
                      Duplicate parts detected ({mergeConflicts.length} conflict
                      {mergeConflicts.length === 1 ? "" : "s"})
                    </p>
                    <p className="mt-1 text-muted-foreground">
                      The same part slug appears more than once — often from overlapping import
                      rules or duplicate addon layers.
                    </p>
                    <ul className="mt-2 space-y-1 text-xs">
                      {mergeConflictGroups.map(([filename, count]) => (
                        <li key={filename} className="flex flex-wrap items-center gap-2">
                          <span className="font-mono text-foreground">{filename}</span>
                          <span className="text-muted-foreground">
                            — {count} variant{count === 1 ? "" : "s"}
                          </span>
                        </li>
                      ))}
                    </ul>
                    <Link
                      to={buildRoute(selectedProfileId)}
                      className="mt-2 inline-block text-xs text-primary underline"
                    >
                      Resolve in Build
                    </Link>
                  </div>
                </div>
              )}
              {blockers.map((issue, i) => (
                <div
                  key={`b-${i}`}
                  className="flex gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm"
                >
                  <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-hidden />
                  <div>
                    <p>{issue.message}</p>
                    {issue.link_hint && hintRoute(issue.link_hint, selectedProfileId) && (
                      <div className="mt-1 flex flex-wrap gap-2">
                        <Link
                          to={hintRoute(issue.link_hint, selectedProfileId)!}
                          className="text-xs text-primary underline"
                        >
                          {issue.link_hint === "sources" ? "Go to Sources" : "Fix on Build"}
                        </Link>
                        {issue.link_hint === "sources" &&
                          review?.layers.some((l) => !l.synced) && (
                            <button
                              type="button"
                              className="text-xs text-primary underline"
                              onClick={syncUnsyncedLayers}
                              disabled={syncJob.busy}
                            >
                              {syncJob.busy ? "Syncing…" : "Sync sources"}
                            </button>
                          )}
                      </div>
                    )}
                  </div>
                </div>
              ))}
              {warnings
                .filter((i) => i.code !== "merge_conflict")
                .map((issue, i) => (
                <div
                  key={`w-${i}`}
                  className="flex gap-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm"
                >
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden />
                  <div>
                    <p>{issue.message}</p>
                    {issue.link_hint && hintRoute(issue.link_hint, selectedProfileId) && (
                      <div className="mt-1 flex flex-wrap gap-2">
                        <Link
                          to={hintRoute(issue.link_hint, selectedProfileId)!}
                          className="text-xs text-primary underline"
                        >
                          {issue.link_hint === "sources" ? "Go to Sources" : "Fix on Build"}
                        </Link>
                        {issue.link_hint === "sources" &&
                          review?.layers.some((l) => !l.synced) && (
                            <button
                              type="button"
                              className="text-xs text-primary underline"
                              onClick={syncUnsyncedLayers}
                              disabled={syncJob.busy}
                            >
                              {syncJob.busy ? "Syncing…" : "Sync sources"}
                            </button>
                          )}
                      </div>
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
