import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { FileArchive } from "lucide-react";
import DeskNextStep from "../components/layout/DeskNextStep";
import PageHeader from "../components/layout/PageHeader";
import RouteBreadcrumbs from "../components/layout/RouteBreadcrumbs";
import ExportActionCards from "../components/export/ExportActionCards";
import ExportRecentPanel, { hasExportJobs } from "../components/export/ExportRecentPanel";
import PartsManifestTransfer from "../components/export/PartsManifestTransfer";
import KitPrinterSelectPanel from "../components/export/KitPrinterSelectPanel";
import ManualAssignmentPanel from "../components/export/ManualAssignmentPanel";
import PlatePreviewPanel from "../components/export/PlatePreviewPanel";
import SlicerLinksPanel from "../components/export/SlicerLinksPanel";
import SlicerHandoffPanel from "../components/export/SlicerHandoffPanel";
// Lazy: PrinterSendPanel pulls in heavy printer integration + dnd-kit
const PrinterSendPanel = lazy(() => import("../components/export/PrinterSendPanel"));
import ShareBuildExportDialog from "../components/share/ShareBuildExportDialog";
import { Button } from "../components/ui/button";
import { Card, CardContent } from "../components/ui/card";
import { fetchRoleFilaments, type RoleFilamentRow } from "../api/engine";
import { useJobContext } from "../context/JobContext";
import { usePlanWorkspace } from "../context/PlanWorkspaceContext";
import { useProfileSelection } from "../context/ProfileContext";
import { useEngineHealth } from "../hooks/useEngineHealth";
import { useSourcesQuery } from "../queries/sources";
import { checkoffUnitTotals } from "../lib/checkoffProgress";
import { deskNextStepLine } from "../lib/deskNextStep";
import { flattenReviewParts } from "../lib/reviewParts";
import { partsRoute, planRoute } from "../lib/routes";
import { cn } from "../lib/utils";
import {
  getBackgroundError,
  resolveEngineState,
  resolveResourceState,
  shouldMountPlanTools,
} from "../lib/workflowState";

/**
 * Export — printer Send panel binds to the active spine plan (GRE-232).
 * Slicer-input file cards (STL, 3MF, share, manifest) stay plan-gated below.
 * Farm-queue verbs (Send ready / Send now / Remove) live on Progress, not here.
 */
export default function ExportPage() {
  const { health, error: engineError, loading: healthLoading } = useEngineHealth();
  const {
    selectedProfileId,
    profiles,
    loading: profilesLoading,
    error: profilesError,
    reloadProfiles,
  } = useProfileSelection();
  const { review, invalidate, loading, reload, revision, loadedRevision, error: planError } =
    usePlanWorkspace();
  const { data: sources = [] } = useSourcesQuery();
  const { activeJobs } = useJobContext();
  const [shareOpen, setShareOpen] = useState(false);
  const [roleFilaments, setRoleFilaments] = useState<RoleFilamentRow[]>([]);
  const [roleFilamentError, setRoleFilamentError] = useState<string | null>(null);
  const engineState = resolveEngineState({
    health,
    loading: healthLoading,
    error: engineError,
  });
  const profilesState = resolveResourceState({
    loading: profilesLoading,
    error: profilesError,
    hasData: profiles.length > 0,
  });
  const profilesBackgroundError = getBackgroundError(
    profilesError,
    profiles.length > 0,
  );
  const planToolsReady = shouldMountPlanTools(engineState, selectedProfileId);

  const showRecent = hasExportJobs(activeJobs);

  const planName =
    selectedProfileId != null
      ? profiles.find((p) => p.id === selectedProfileId)?.name
      : null;

  const includedParts = useMemo(() => {
    if (!review) return [];
    return flattenReviewParts(review.part_groups).filter((p) => p.included);
  }, [review]);
  const remainingParts = useMemo(
    () => includedParts.filter((p) => p.missing),
    [includedParts],
  );
  const remainingUnits = checkoffUnitTotals(includedParts).remainingUnits;
  const exportNextStep = deskNextStepLine("export", { remainingUnits });

  useEffect(() => {
    if (!health?.ok || selectedProfileId == null) {
      setRoleFilaments([]);
      setRoleFilamentError(null);
      return;
    }
    setRoleFilamentError(null);
    let cancelled = false;
    void fetchRoleFilaments(selectedProfileId)
      .then((rows) => {
        if (!cancelled) setRoleFilaments(rows);
      })
      .catch((e) => {
        if (!cancelled) {
          setRoleFilamentError(
            `Could not refresh filament assignments: ${
              e instanceof Error ? e.message : String(e)
            }`,
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, [health?.ok, selectedProfileId, revision]);

  useEffect(() => {
    if (!health?.ok || selectedProfileId == null) return;
    if (review?.profile_id !== selectedProfileId || loadedRevision < revision) {
      void reload(selectedProfileId);
    }
  }, [health?.ok, selectedProfileId, revision, loadedRevision, reload, review?.profile_id]);

  const planIdentity =
    planName && includedParts.length > 0
      ? `${planName} · ${includedParts.length} part${includedParts.length === 1 ? "" : "s"}`
      : planName;

  return (
    <div className="space-y-4">
      <RouteBreadcrumbs
        items={[
          { label: "Plan", to: planRoute(selectedProfileId) },
          { label: "Export" },
        ]}
      />
      <PageHeader
        icon={FileArchive}
        accent
        eyebrow={planIdentity}
        title="Export"
        description="Send already-sliced G-code from your slicer. STL and 3MF below are slicer input."
      />
      <DeskNextStep>{exportNextStep}</DeskNextStep>

      {(profilesBackgroundError || roleFilamentError || (planError && review)) && (
        <div className="space-y-1 text-sm text-destructive" role="alert">
          {profilesBackgroundError && (
            <p>Could not refresh plans: {profilesBackgroundError}</p>
          )}
          {roleFilamentError && <p>{roleFilamentError}</p>}
          {planError && review && <p>Could not refresh this plan: {planError}</p>}
        </div>
      )}

      {engineState !== "ready" ? (
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">
              {engineState === "offline"
                ? "Engine offline — start the print-partner engine to export."
                : "Connecting to the engine…"}
            </p>
          </CardContent>
        </Card>
      ) : profilesState === "error" ? (
        <Card className="border-destructive/40 bg-destructive/5 shadow-none">
          <CardContent className="space-y-3 pt-6">
            <p className="text-sm text-destructive">
              Could not load plans: {profilesError}
            </p>
            <Button size="sm" variant="secondary" onClick={() => void reloadProfiles()}>
              Retry
            </Button>
          </CardContent>
        </Card>
      ) : profilesState === "loading" ? (
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">Loading plans…</p>
          </CardContent>
        </Card>
      ) : !planToolsReady ? (
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">
              Open a plan to send sliced files or export slicer input.
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          <Suspense fallback={<div className="h-32 animate-pulse rounded-lg bg-muted" />}>
            <PrinterSendPanel
              remainingParts={remainingParts}
              profileId={selectedProfileId}
              planName={planName}
              engineReady={engineState === "ready"}
            />
          </Suspense>

          <div className="space-y-3">
            <h2 className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              Slicer input
            </h2>

            <SlicerLinksPanel />
            <SlicerHandoffPanel />

            <KitPrinterSelectPanel
              profileId={selectedProfileId}
              engineReady={engineState === "ready"}
            />

            <ManualAssignmentPanel
              profileId={selectedProfileId}
              engineReady={engineState === "ready"}
            />

            <PlatePreviewPanel
              profileId={selectedProfileId}
              engineReady={engineState === "ready"}
            />

            {loading && !review ? (
              <Card>
                <CardContent className="pt-6">
                  <p className="text-sm text-muted-foreground">Loading plan…</p>
                </CardContent>
              </Card>
            ) : planError && !review ? (
              <Card>
                <CardContent className="pt-6 space-y-3">
                  <p className="text-sm text-destructive">
                    Could not load this plan: {planError}
                  </p>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => {
                      if (selectedProfileId != null) void reload(selectedProfileId);
                    }}
                  >
                    Retry
                  </Button>
                </CardContent>
              </Card>
            ) : (
              <div
                className={cn(
                  "grid gap-4",
                  showRecent && "lg:grid-cols-[minmax(0,1fr)_minmax(16rem,18.75rem)]",
                )}
              >
                <div className="min-w-0">
                  <ExportActionCards
                    onShare={() => setShareOpen(true)}
                    roleFilaments={roleFilaments}
                  />
                </div>
                {showRecent ? <ExportRecentPanel /> : null}
              </div>
            )}

            <PartsManifestTransfer
              review={review}
              sources={sources}
              onApplied={() => void invalidate()}
            />
          </div>

          <div className="flex flex-wrap gap-2">
            <Button variant="ghost" size="sm" asChild>
              <Link to={partsRoute(selectedProfileId)}>Back to Parts</Link>
            </Button>
            <Button variant="ghost" size="sm" asChild>
              <Link to={planRoute(selectedProfileId)}>Open Plan</Link>
            </Button>
          </div>
        </>
      )}

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
