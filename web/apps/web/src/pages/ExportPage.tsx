import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { FileArchive } from "lucide-react";
import PageHeader from "../components/layout/PageHeader";
import RouteBreadcrumbs from "../components/layout/RouteBreadcrumbs";
import ExportActionCards from "../components/export/ExportActionCards";
import ExportRecentPanel, { hasExportJobs } from "../components/export/ExportRecentPanel";
import PartsManifestTransfer from "../components/export/PartsManifestTransfer";
import ShareBuildExportDialog from "../components/share/ShareBuildExportDialog";
import EmptyState from "../components/layout/EmptyState";
import { Button } from "../components/ui/button";
import { Card, CardContent } from "../components/ui/card";
import { useJobContext } from "../context/JobContext";
import { usePlanWorkspace } from "../context/PlanWorkspaceContext";
import { useProfileSelection } from "../context/ProfileContext";
import { useEngineHealth } from "../hooks/useEngineHealth";
import { useSourcesQuery } from "../queries/sources";
import { flattenReviewParts } from "../lib/reviewParts";
import { partsRoute, planRoute } from "../lib/routes";
import { cn } from "../lib/utils";

/**
 * Export hub — consolidates STL / checklist / share / 3MF / parts-manifest actions.
 */
export default function ExportPage() {
  const navigate = useNavigate();
  const { health, error: engineError } = useEngineHealth();
  const { selectedProfileId, profiles } = useProfileSelection();
  const { review, invalidate, loading, reload, revision, loadedRevision, error: planError } =
    usePlanWorkspace();
  const { data: sources = [] } = useSourcesQuery();
  const { activeJobs } = useJobContext();
  const [shareOpen, setShareOpen] = useState(false);

  const showRecent = hasExportJobs(activeJobs);

  const planName =
    selectedProfileId != null
      ? profiles.find((p) => p.id === selectedProfileId)?.name
      : null;

  const includedParts = useMemo(() => {
    if (!review) return [];
    return flattenReviewParts(review.part_groups).filter((p) => p.included);
  }, [review]);
  const missingCount = useMemo(
    () => includedParts.filter((p) => p.missing).length,
    [includedParts],
  );

  useEffect(() => {
    if (!health?.ok || selectedProfileId == null) return;
    if (review?.profile_id !== selectedProfileId || loadedRevision < revision) {
      void reload(selectedProfileId);
    }
  }, [health?.ok, selectedProfileId, revision, loadedRevision, reload, review?.profile_id]);

  const headerMeta =
    planName && includedParts.length > 0
      ? `${planName} · ${includedParts.length} parts${
          missingCount > 0 ? ` · ${missingCount} missing` : ""
        }`
      : planName
        ? planName
        : null;

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
        title="Export hub"
        description={
          headerMeta
            ? `Everything that leaves Print Partner, in one place · ${headerMeta}`
            : "Everything that leaves Print Partner, in one place"
        }
      />

      {!health ? (
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">
              {engineError
                ? "Engine offline — start the print-partner engine to export."
                : "Connecting to the engine…"}
            </p>
          </CardContent>
        </Card>
      ) : selectedProfileId == null ? (
        <EmptyState
          icon={FileArchive}
          title="No plan selected"
          description="Choose a plan first, then export STLs, checklists, or a share bundle."
          action={{
            label: "Open Plan",
            onClick: () => navigate(planRoute(null)),
          }}
        />
      ) : loading && !review ? (
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
        <>
          <div
            className={cn(
              "grid gap-4",
              showRecent && "lg:grid-cols-[minmax(0,1fr)_minmax(16rem,18.75rem)]",
            )}
          >
            <div className="min-w-0">
              <ExportActionCards onShare={() => setShareOpen(true)} />
            </div>
            {showRecent ? <ExportRecentPanel /> : null}
          </div>

          <PartsManifestTransfer
            review={review}
            sources={sources}
            onApplied={() => void invalidate()}
          />

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
