import { Link } from "react-router-dom";
import PageHeader from "../components/layout/PageHeader";
import PlanManager from "../components/PlanManager";
import RouteBreadcrumbs from "../components/layout/RouteBreadcrumbs";
import { Button } from "../components/ui/button";
import { useProfileSelection } from "../context/ProfileContext";
import { useEngineHealth } from "../hooks/useEngineHealth";
import { buildRoute } from "../lib/routes";

export default function BuildsPage() {
  const { health } = useEngineHealth();
  const { selectedProfileId, profiles } = useProfileSelection();
  const activeName = profiles.find((p) => p.id === selectedProfileId)?.name;

  return (
    <div className="space-y-4">
      <RouteBreadcrumbs items={[{ label: "Builds" }]} />
      <PageHeader
        title="Builds"
        description="Create, rename, duplicate, and delete build plans. The header dropdown switches which plan Build, Review, and Checkoff use."
        actions={
          selectedProfileId != null ? (
            <Button className="min-h-10 w-full sm:w-auto" asChild>
              <Link to={buildRoute(selectedProfileId)}>
                Open Build{activeName ? `: ${activeName}` : ""}
              </Link>
            </Button>
          ) : undefined
        }
      />

      <div className="rounded-lg border border-border bg-card p-4">
        <PlanManager hideSelector={false} disabled={!health} />
      </div>
    </div>
  );
}
