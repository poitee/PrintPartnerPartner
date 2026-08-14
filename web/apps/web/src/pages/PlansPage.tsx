import { useMemo, useState } from "react";
import { Archive, Copy, Layers, MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";
import PageHeader from "../components/layout/PageHeader";
import PageHeaderActions from "../components/layout/PageHeaderActions";
import EmptyState from "../components/layout/EmptyState";
import RouteBreadcrumbs from "../components/layout/RouteBreadcrumbs";
import { Button } from "../components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "../components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../components/ui/dropdown-menu";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { SegmentedControl } from "../components/ui/segmented-control";
import { Switch } from "../components/ui/switch";
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
import {
  useArchiveProfileMutation,
  useDeleteProfileMutation,
  useDuplicateProfileMutation,
  useTouchProfileLastUsedMutation,
  useUpdateProfileMutation,
} from "../queries/profiles";
import type { ProfileSummary } from "../api/engine";

type RowAction = {
  plan: ProfileSummary;
  kind: "rename" | "duplicate" | "delete" | "archive";
};

/** Dedicated Plans list — not a spine desk-loop step (GRE-228). */
export default function PlansPage() {
  const { health } = useEngineHealth();
  const { profiles, selectedProfileId, setSelectedProfileId, loading } =
    useProfileSelection();
  const { openCreatePlan } = usePlanActions();
  const updateMutation = useUpdateProfileMutation();
  const deleteMutation = useDeleteProfileMutation();
  const duplicateMutation = useDuplicateProfileMutation();
  const archiveMutation = useArchiveProfileMutation();
  const touchMutation = useTouchProfileLastUsedMutation();

  const [filter, setFilter] = useState<PlansListFilter>("active");
  const [action, setAction] = useState<RowAction | null>(null);
  const [renameName, setRenameName] = useState("");
  const [duplicateName, setDuplicateName] = useState("");
  const [duplicateClearCheckoff, setDuplicateClearCheckoff] = useState(false);

  const rows = useMemo(
    () => filterPlansList(profiles, filter),
    [profiles, filter],
  );

  const busy =
    updateMutation.isPending ||
    deleteMutation.isPending ||
    duplicateMutation.isPending ||
    archiveMutation.isPending;

  /** GRE-231: activate spine plan only — stay on /plans; do not navigate to /plan or unarchive. */
  const selectPlan = (id: number) => {
    setSelectedProfileId(id);
    touchMutation.mutate(id);
  };

  const openRename = (plan: ProfileSummary) => {
    setRenameName(plan.name);
    setAction({ plan, kind: "rename" });
  };

  const openDuplicate = (plan: ProfileSummary) => {
    setDuplicateName(`${plan.name} (copy)`);
    setDuplicateClearCheckoff(false);
    setAction({ plan, kind: "duplicate" });
  };

  const openDelete = (plan: ProfileSummary) => {
    setAction({ plan, kind: "delete" });
  };

  const openArchive = (plan: ProfileSummary) => {
    setAction({ plan, kind: "archive" });
  };

  const onRename = async () => {
    if (action?.kind !== "rename") return;
    const name = renameName.trim();
    if (!name) return;
    try {
      await updateMutation.mutateAsync({ id: action.plan.id, name });
      setAction(null);
      toast.success(`Renamed plan to “${name}”`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };

  const onDuplicate = async () => {
    if (action?.kind !== "duplicate") return;
    const name = duplicateName.trim();
    if (!name) return;
    try {
      const copy = await duplicateMutation.mutateAsync({
        id: action.plan.id,
        name,
        clearCheckoff: duplicateClearCheckoff,
      });
      setAction(null);
      setSelectedProfileId(copy.id);
      touchMutation.mutate(copy.id);
      toast.success(`Duplicated plan “${name}”`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };

  const onDelete = async () => {
    if (action?.kind !== "delete") return;
    const deletedName = action.plan.name;
    try {
      await deleteMutation.mutateAsync(action.plan.id);
      setAction(null);
      toast.success(`Deleted plan “${deletedName}”`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };

  const onArchive = async () => {
    if (action?.kind !== "archive") return;
    try {
      await archiveMutation.mutateAsync(action.plan.id);
      setAction(null);
      toast.success(`Archived “${action.plan.name}”`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };

  const emptyAll = !loading && profiles.length === 0;
  const emptyFilter = !loading && profiles.length > 0 && rows.length === 0;

  return (
    <div className="space-y-4">
      <RouteBreadcrumbs items={[{ label: "Plans", to: plansRoute(selectedProfileId) }]} />
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
      ) : (
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
                            disabled={!health || busy}
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
                                disabled={!health || busy}
                                aria-label={`Actions for ${plan.name}`}
                                onClick={(e) => e.stopPropagation()}
                              >
                                <MoreHorizontal className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-44">
                              <DropdownMenuItem onClick={() => openRename(plan)}>
                                <Pencil className="mr-2 h-4 w-4" />
                                Rename
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => openDuplicate(plan)}>
                                <Copy className="mr-2 h-4 w-4" />
                                Duplicate
                              </DropdownMenuItem>
                              {archiveAllowed ? (
                                <DropdownMenuItem onClick={() => openArchive(plan)}>
                                  <Archive className="mr-2 h-4 w-4" />
                                  Archive
                                </DropdownMenuItem>
                              ) : null}
                              <DropdownMenuItem onClick={() => openDelete(plan)}>
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

      <Dialog
        open={action?.kind === "rename"}
        onOpenChange={(open) => !open && setAction(null)}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Rename plan</DialogTitle>
          </DialogHeader>
          <div className="space-y-1">
            <Label htmlFor="plans-rename-name">Name</Label>
            <Input
              id="plans-rename-name"
              value={renameName}
              onChange={(e) => setRenameName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void onRename()}
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setAction(null)}>
              Cancel
            </Button>
            <Button disabled={!renameName.trim() || busy} onClick={() => void onRename()}>
              Rename
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={action?.kind === "duplicate"}
        onOpenChange={(open) => !open && setAction(null)}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Duplicate plan</DialogTitle>
          </DialogHeader>
          <div className="space-y-1">
            <Label htmlFor="plans-dup-name">Name</Label>
            <Input
              id="plans-dup-name"
              value={duplicateName}
              onChange={(e) => setDuplicateName(e.target.value)}
            />
          </div>
          <label className="flex items-start justify-between gap-3 rounded-md border border-border p-3">
            <span className="space-y-0.5">
              <span className="block text-sm font-medium">Clear checkoff progress</span>
              <span className="block text-xs text-muted-foreground">
                Start the copy with nothing marked printed.
              </span>
            </span>
            <Switch
              checked={duplicateClearCheckoff}
              onCheckedChange={setDuplicateClearCheckoff}
            />
          </label>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setAction(null)}>
              Cancel
            </Button>
            <Button
              disabled={!duplicateName.trim() || busy}
              onClick={() => void onDuplicate()}
            >
              Duplicate
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={action?.kind === "delete"}
        onOpenChange={(open) => !open && setAction(null)}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Delete plan?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Delete “{action?.plan.name}” and all its parts, layers, and print settings?
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setAction(null)}>
              Cancel
            </Button>
            <Button variant="ghost" disabled={busy} onClick={() => void onDelete()}>
              Delete
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={action?.kind === "archive"}
        onOpenChange={(open) => !open && setAction(null)}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Archive plan?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Archive “{action?.plan.name}”? It stays in the picker as a template.
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setAction(null)}>
              Cancel
            </Button>
            <Button disabled={busy} onClick={() => void onArchive()}>
              Archive
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
