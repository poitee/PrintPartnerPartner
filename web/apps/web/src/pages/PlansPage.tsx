import { useMemo, useState } from "react";
import {
  Archive,
  Copy,
  Layers,
  MoreHorizontal,
  Pencil,
  Trash2,
} from "lucide-react";
import PageHeader from "../components/layout/PageHeader";
import PageHeaderActions from "../components/layout/PageHeaderActions";
import EmptyState from "../components/layout/EmptyState";
import RouteBreadcrumbs from "../components/layout/RouteBreadcrumbs";
import { Button } from "../components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../components/ui/dropdown-menu";
import { SegmentedControl } from "../components/ui/segmented-control";
import { usePlanActions } from "../context/PlanActionsContext";
import { useProfileSelection } from "../context/ProfileContext";
import { useEngineHealth } from "../hooks/useEngineHealth";
import { canArchivePlan } from "../lib/planPickerGroups";
import {
  filterPlansList,
  planStatusLabel,
  type PlansListFilter,
} from "../lib/plansList";
import { plansRoute } from "../lib/routes";
import { cn } from "../lib/utils";
import { useTouchProfileLastUsedMutation } from "../queries/profiles";

/** Dedicated Plans list — not a spine desk-loop step (GRE-228). */
export default function PlansPage() {
  const { health } = useEngineHealth();
  const { profiles, selectedProfileId, setSelectedProfileId, loading } =
    useProfileSelection();
  const {
    openCreatePlan,
    openRenamePlan,
    openDuplicatePlan,
    openDeletePlan,
    openArchivePlan,
  } = usePlanActions();
  const touchMutation = useTouchProfileLastUsedMutation();

  const [filter, setFilter] = useState<PlansListFilter>("active");

  const rows = useMemo(
    () => filterPlansList(profiles, filter),
    [profiles, filter],
  );

  /** GRE-231: activate spine plan only — stay on /plans; do not navigate to /plan or unarchive. */
  const selectPlan = (id: number) => {
    setSelectedProfileId(id);
    touchMutation.mutate(id);
  };

  // Profiles query is disabled until health.ok; treat that as not-yet-loaded, not empty.
  const emptyAll = Boolean(health?.ok) && !loading && profiles.length === 0;
  const emptyFilter = !loading && profiles.length > 0 && rows.length === 0;

  return (
    <div className="space-y-4">
      <RouteBreadcrumbs
        items={[{ label: "Plans", to: plansRoute(selectedProfileId) }]}
      />
      <PageHeader
        icon={Layers}
        accent
        title="Plans"
        description="Switch the spine plan, or manage templates. Picker stays the quick switcher."
        actions={
          <PageHeaderActions>
            <Button
              className="min-h-10 w-full sm:w-auto"
              onClick={openCreatePlan}
              disabled={!health}
            >
              Create plan
            </Button>
          </PageHeaderActions>
        }
      />

      {emptyAll ? (
        <EmptyState
          icon={Layers}
          title="Create a plan to start the desk loop."
          action={{ label: "Create plan", onClick: openCreatePlan }}
        />
      ) : !health?.ok && profiles.length === 0 ? null : (
        <>
          <SegmentedControl
            aria-label="Plan status filter"
            value={filter}
            onValueChange={setFilter}
            options={[
              { value: "active", label: "Active" },
              { value: "archived", label: "Archived" },
              { value: "all", label: "All" },
            ]}
          />

          {emptyFilter ? (
            <p className="text-sm text-muted-foreground">
              No {filter === "archived" ? "archived" : "active"} plans.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[36rem] border-collapse text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs text-muted-foreground">
                    <th className="py-2 pr-3 font-medium">Name</th>
                    <th className="py-2 pr-3 font-medium">Status</th>
                    <th className="py-2 pr-3 font-medium">Remaining</th>
                    <th className="py-2 pr-3 font-medium">Parts</th>
                    <th className="py-2 pr-3 font-medium">Stale</th>
                    <th className="py-2 pl-2 font-medium">
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((plan) => {
                    const selected = plan.id === selectedProfileId;
                    const archiveAllowed = canArchivePlan({
                      archived: Boolean(plan.archived_at),
                      totalUnits: plan.total_units,
                      remainingUnits: plan.remaining_units,
                    });
                    return (
                      <tr
                        key={plan.id}
                        className={cn(
                          "border-b border-border/80 transition-colors",
                          selected ? "bg-primary/8" : "hover:bg-muted/40",
                        )}
                      >
                        <td className="py-2.5 pr-3">
                          <button
                            type="button"
                            className={cn(
                              "max-w-[16rem] truncate text-left font-medium underline-offset-2 hover:underline",
                              selected && "text-primary",
                            )}
                            onClick={() => selectPlan(plan.id)}
                            disabled={!health}
                          >
                            {plan.name}
                          </button>
                        </td>
                        <td className="py-2.5 pr-3 text-muted-foreground">
                          {planStatusLabel(plan)}
                        </td>
                        <td className="py-2.5 pr-3 font-mono tabular-nums text-muted-foreground">
                          {plan.remaining_units}
                        </td>
                        <td className="py-2.5 pr-3 font-mono tabular-nums text-muted-foreground">
                          {plan.part_count}
                        </td>
                        <td className="py-2.5 pr-3 text-muted-foreground">
                          {plan.build_stale ? (
                            <span className="text-xs">stale</span>
                          ) : (
                            <span className="sr-only">fresh</span>
                          )}
                        </td>
                        <td className="py-2.5 pl-2 text-right">
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8"
                                disabled={!health}
                                aria-label={`Actions for ${plan.name}`}
                                onClick={(e) => e.stopPropagation()}
                              >
                                <MoreHorizontal className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-44">
                              <DropdownMenuItem
                                onClick={() => openRenamePlan(plan.id)}
                              >
                                <Pencil className="mr-2 h-4 w-4" />
                                Rename
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onClick={() => openDuplicatePlan(plan.id)}
                              >
                                <Copy className="mr-2 h-4 w-4" />
                                Duplicate
                              </DropdownMenuItem>
                              {archiveAllowed ? (
                                <DropdownMenuItem
                                  onClick={() => openArchivePlan(plan.id)}
                                >
                                  <Archive className="mr-2 h-4 w-4" />
                                  Archive
                                </DropdownMenuItem>
                              ) : null}
                              <DropdownMenuItem
                                onClick={() => openDeletePlan(plan.id)}
                              >
                                <Trash2 className="mr-2 h-4 w-4" />
                                Delete
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
