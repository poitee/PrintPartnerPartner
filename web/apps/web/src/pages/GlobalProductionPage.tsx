import { useMemo } from "react";
import { Link } from "react-router-dom";
import { Factory } from "lucide-react";
import PageHeader from "../components/layout/PageHeader";
import RouteBreadcrumbs from "../components/layout/RouteBreadcrumbs";
import { Button } from "../components/ui/button";
import { Card, CardContent } from "../components/ui/card";
import { useProfileSelection } from "../context/ProfileContext";
import { useEngineHealth } from "../hooks/useEngineHealth";
import { filterPlansList, planProgressLabel } from "../lib/plansList";
import { buildsRoute, productionRoute, progressRoute } from "../lib/routes";
import {
  getBackgroundError,
  resolveEngineState,
  resolveResourceState,
} from "../lib/workflowState";

/** Global Production: remaining Checkoff work across Builds. Printer queue is Phase 9. */
export default function GlobalProductionPage() {
  const { health, error: engineError, loading: healthLoading } = useEngineHealth();
  const {
    profiles,
    loading,
    error: profilesError,
    reloadProfiles,
  } = useProfileSelection();
  const engineState = resolveEngineState({
    health,
    loading: healthLoading,
    error: engineError,
  });
  const profilesState = resolveResourceState({
    loading,
    error: profilesError,
    hasData: profiles.length > 0,
  });
  const profilesBackgroundError = getBackgroundError(
    profilesError,
    profiles.length > 0,
  );
  const rows = useMemo(
    () => filterPlansList(profiles, "active", "", "recent"),
    [profiles],
  );

  return (
    <div className="space-y-4">
      <RouteBreadcrumbs items={[{ label: "Production", to: "/production" }]} />
      <PageHeader
        icon={Factory}
        accent
        title="Production"
        description="Remaining Checkoff work and Build Production across active Builds. Open a row for plates, downloads, and printer jobs on that Build."
      />

      {profilesBackgroundError && (
        <p className="text-sm text-destructive" role="alert">
          Could not refresh builds: {profilesBackgroundError}
        </p>
      )}

      {engineState !== "ready" ? (
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">
              {engineState === "offline"
                ? "Engine offline — start the print-partner engine to see production."
                : "Connecting to the engine…"}
            </p>
          </CardContent>
        </Card>
      ) : profilesState === "error" ? (
        <Card className="border-destructive/40 bg-destructive/5 shadow-none">
          <CardContent className="space-y-3 pt-6">
            <p className="text-sm text-destructive" role="alert">
              Could not load builds: {profilesError}
            </p>
            <Button size="sm" variant="secondary" onClick={() => void reloadProfiles()}>
              Retry
            </Button>
          </CardContent>
        </Card>
      ) : profilesState === "loading" ? (
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">Loading production…</p>
          </CardContent>
        </Card>
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No active Builds.{" "}
          <Link className="underline-offset-2 hover:underline" to={buildsRoute()}>
            Go to Builds
          </Link>
        </p>
      ) : (
        <ul className="space-y-2" aria-label="Production by Build">
          {rows.map((plan) => (
            <li key={plan.id}>
              <Card className="shadow-none">
                <CardContent className="flex flex-wrap items-center justify-between gap-3 p-3">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{plan.name}</p>
                    <p className="font-mono text-xs text-muted-foreground">
                      {planProgressLabel(plan.accepted_progress)}
                      {plan.build_stale ? " · stale" : ""}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-3 text-xs">
                    <Link
                      className="underline-offset-2 hover:underline"
                      to={progressRoute(plan.id)}
                      aria-label={`Checkoff for ${plan.name}`}
                    >
                      Checkoff
                    </Link>
                    <Link
                      className="underline-offset-2 hover:underline"
                      to={productionRoute(plan.id)}
                      aria-label={`Open ${plan.name} in Production`}
                    >
                      Production
                    </Link>
                  </div>
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
