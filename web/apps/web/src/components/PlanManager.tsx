import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronDown } from "lucide-react";
import { toast } from "sonner";
import {
  createProfile,
  deleteProfile,
  duplicateProfile,
  updateProfile,
} from "../api/engine";
import { buildRoute } from "../lib/routes";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { useProfileSelection } from "../context/ProfileContext";

type PlanManagerProps = {
  disabled?: boolean;
  /** When true, omit the plan dropdown (header PlanPicker handles selection). */
  hideSelector?: boolean;
  /** Collapse CRUD behind a summary row (Build page). */
  collapsible?: boolean;
};

/** Full plan CRUD — use on Build; workflow pages use header PlanPicker for switching. */
type SwitchPrompt = {
  targetId: number;
  targetName: string;
  actionLabel: "created" | "duplicated";
};

export default function PlanManager({ disabled, hideSelector, collapsible }: PlanManagerProps) {
  const navigate = useNavigate();
  const {
    profiles,
    selectedProfileId,
    setSelectedProfileId,
    reloadProfiles,
    loading,
  } = useProfileSelection();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [renameName, setRenameName] = useState("");
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [duplicateOpen, setDuplicateOpen] = useState(false);
  const [duplicateName, setDuplicateName] = useState("");
  const [switchPrompt, setSwitchPrompt] = useState<SwitchPrompt | null>(null);

  const selected = profiles.find((p) => p.id === selectedProfileId);

  const shouldAskToSwitch = () => {
    if (selectedProfileId == null) return false;
    return (selected?.part_count ?? 0) > 0;
  };

  const activatePlan = (id: number) => {
    setSelectedProfileId(id);
    navigate(buildRoute(id), { replace: true });
  };

  const offerSwitchOrActivate = (targetId: number, targetName: string, actionLabel: SwitchPrompt["actionLabel"]) => {
    if (shouldAskToSwitch() && selectedProfileId !== targetId) {
      setSwitchPrompt({ targetId, targetName, actionLabel });
      return;
    }
    activatePlan(targetId);
    const verb = actionLabel === "created" ? "Created" : "Duplicated";
    toast.success(`${verb} plan “${targetName}”`);
  };

  useEffect(() => {
    setRenameName(selected?.name ?? "");
  }, [selected?.id, selected?.name]);

  const run = async (fn: () => Promise<void>, successMessage?: string) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await reloadProfiles();
      if (successMessage) toast.success(successMessage);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  };

  const onCreate = () => {
    const name = newName.trim();
    if (!name) return;
    void run(async () => {
      const created = await createProfile(name);
      setNewName("");
      offerSwitchOrActivate(created.id, name, "created");
    });
  };

  const onRename = () => {
    if (selectedProfileId == null) return;
    const name = renameName.trim();
    if (!name) return;
    void run(
      async () => {
        await updateProfile(selectedProfileId, name);
        setRenameName(name);
      },
      `Renamed plan to “${name}”`,
    );
  };

  const openDuplicateDialog = () => {
    if (selectedProfileId == null) return;
    const base = selected?.name ?? "Plan";
    setDuplicateName(`${base} (copy)`);
    setDuplicateOpen(true);
  };

  const confirmDuplicate = () => {
    if (selectedProfileId == null) return;
    const name = duplicateName.trim();
    if (!name) return;
    setDuplicateOpen(false);
    void run(async () => {
      const copy = await duplicateProfile(selectedProfileId, name);
      offerSwitchOrActivate(copy.id, name, "duplicated");
    });
  };

  const confirmSwitchToNewPlan = () => {
    if (!switchPrompt) return;
    const { targetId, targetName, actionLabel } = switchPrompt;
    setSwitchPrompt(null);
    activatePlan(targetId);
    const verb = actionLabel === "created" ? "Created" : "Duplicated";
    toast.success(`${verb} plan “${targetName}”`);
  };

  const stayOnCurrentPlan = () => {
    if (!switchPrompt) return;
    const { targetName, actionLabel } = switchPrompt;
    const currentName = selected?.name ?? "current plan";
    setSwitchPrompt(null);
    const verb = actionLabel === "created" ? "Created" : "Duplicated";
    toast.success(`${verb} “${targetName}” — still on “${currentName}”`);
  };

  const openDeleteDialog = () => {
    if (selectedProfileId == null || !selected) return;
    setDeleteOpen(true);
  };

  const confirmDelete = () => {
    if (selectedProfileId == null || !selected) return;
    const deletingId = selectedProfileId;
    const deletedName = selected.name;
    setDeleteOpen(false);
    void run(
      async () => {
        await deleteProfile(deletingId);
        // reloadProfiles (called by run) picks the next plan when the deleted id is stale.
      },
      `Deleted plan “${deletedName}”`,
    );
  };

  const body = (
    <div className="space-y-3">
      {!hideSelector && (
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-xs text-muted-foreground">Plan</span>
          <select
            className="rounded-md border border-input bg-background px-2 py-1.5"
            value={selectedProfileId ?? ""}
            onChange={(e) => {
              const v = e.target.value;
              setSelectedProfileId(v === "" ? null : Number(v));
              setRenameName("");
            }}
            disabled={disabled || loading || busy || profiles.length === 0}
          >
            {profiles.length === 0 ? (
              <option value="">No plans yet</option>
            ) : (
              profiles.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({p.part_count} parts)
                </option>
              ))
            )}
          </select>
        </label>
      )}

      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-end">
        <div className="min-w-0 flex-1 space-y-1 sm:min-w-[12rem]">
          <Label htmlFor="plan-new-name" className="text-xs text-muted-foreground">
            New plan
          </Label>
          <Input
            id="plan-new-name"
            placeholder="Name"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") onCreate();
            }}
            disabled={disabled || busy}
          />
        </div>
        <Button
          size="sm"
          className="min-h-10 w-full sm:w-auto"
          onClick={onCreate}
          disabled={disabled || busy || !newName.trim()}
        >
          Create
        </Button>
      </div>

      {selectedProfileId != null && (
        <div className="flex flex-col gap-2 border-t border-border pt-3 sm:flex-row sm:flex-wrap sm:items-end">
          <div className="min-w-0 flex-1 space-y-1 sm:min-w-[12rem]">
            <Label htmlFor="plan-rename" className="text-xs text-muted-foreground">
              Rename current plan
            </Label>
            <Input
              id="plan-rename"
              value={renameName}
              onChange={(e) => setRenameName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") onRename();
              }}
              disabled={disabled || busy}
            />
          </div>
          <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
            <Button
              size="sm"
              className="min-h-10"
              variant="secondary"
              onClick={onRename}
              disabled={disabled || busy || !renameName.trim()}
            >
              Rename
            </Button>
            <Button
              size="sm"
              className="min-h-10"
              variant="secondary"
              onClick={openDuplicateDialog}
              disabled={disabled || busy}
            >
              Duplicate
            </Button>
            <Button
              size="sm"
              className="col-span-2 min-h-10 sm:col-span-1"
              variant="ghost"
              onClick={openDeleteDialog}
              disabled={disabled || busy}
            >
              Delete
            </Button>
          </div>
        </div>
      )}

      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );

  return (
    <div className="plan-manager">
      {collapsible ? (
        <details className="group rounded-lg border border-border bg-card">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-4 py-3 [&::-webkit-details-marker]:hidden">
            <div className="min-w-0">
              <p className="text-sm font-semibold">Plan settings</p>
              <p className="truncate text-xs text-muted-foreground">
                {selected
                  ? `${selected.name} · ${selected.part_count} part${selected.part_count === 1 ? "" : "s"}`
                  : "No plan selected — use the header dropdown"}
              </p>
            </div>
            <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
          </summary>
          <div className="border-t border-border px-4 pb-4 pt-3">{body}</div>
        </details>
      ) : (
        body
      )}

      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Delete plan?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            {selected
              ? `Delete plan “${selected.name}” and all its parts, layers, and print settings?`
              : ""}
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" disabled={busy} onClick={() => setDeleteOpen(false)}>
              Cancel
            </Button>
            <Button variant="ghost" disabled={busy} onClick={confirmDelete}>
              {busy ? "Deleting…" : "Delete"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={switchPrompt != null} onOpenChange={(open) => !open && setSwitchPrompt(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Switch to {switchPrompt?.actionLabel === "created" ? "new" : "duplicated"} plan?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            {switchPrompt && selected
              ? `${switchPrompt.actionLabel === "created" ? "Created" : "Duplicated"} “${switchPrompt.targetName}”. Switch to it now, or stay on “${selected.name}”?`
              : ""}
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" disabled={busy} onClick={stayOnCurrentPlan}>
              Stay on current
            </Button>
            <Button disabled={busy} onClick={confirmSwitchToNewPlan}>
              Switch plan
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={duplicateOpen} onOpenChange={setDuplicateOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Duplicate plan</DialogTitle>
          </DialogHeader>
          <div className="space-y-1">
            <Label htmlFor="duplicate-plan-name">Name for duplicated plan</Label>
            <Input
              id="duplicate-plan-name"
              value={duplicateName}
              onChange={(e) => setDuplicateName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") confirmDuplicate();
              }}
              disabled={busy}
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" disabled={busy} onClick={() => setDuplicateOpen(false)}>
              Cancel
            </Button>
            <Button disabled={busy || !duplicateName.trim()} onClick={confirmDuplicate}>
              {busy ? "Duplicating…" : "Duplicate"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
