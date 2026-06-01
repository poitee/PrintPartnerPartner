import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  createProfile,
  deleteProfile,
  duplicateProfile,
  updateProfile,
} from "../api/engine";
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

/** Full plan CRUD — use on Plan and Kit Studio only; workflow pages use header PlanPicker. */
export default function PlanManager({ disabled }: { disabled?: boolean }) {
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

  const selected = profiles.find((p) => p.id === selectedProfileId);

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
    void run(
      async () => {
        const created = await createProfile(name);
        setSelectedProfileId(created.id);
        setNewName("");
      },
      `Created plan “${name}”`,
    );
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
    void run(
      async () => {
        const copy = await duplicateProfile(selectedProfileId, name);
        setSelectedProfileId(copy.id);
      },
      `Duplicated plan as “${name}”`,
    );
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

  return (
    <div className="plan-manager space-y-2">
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

      <div className="flex flex-wrap gap-2">
        <input
          className="min-w-0 flex-1 rounded-md border border-input bg-background px-2 py-1 text-sm"
          placeholder="New plan name"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") onCreate();
          }}
          disabled={disabled || busy}
        />
        <Button size="sm" onClick={onCreate} disabled={disabled || busy || !newName.trim()}>
          New
        </Button>
      </div>

      {selectedProfileId != null && (
        <div className="flex flex-wrap items-center gap-2">
          <input
            className="min-w-0 flex-1 rounded-md border border-input bg-background px-2 py-1 text-sm"
            placeholder="Rename plan"
            value={renameName}
            onChange={(e) => setRenameName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") onRename();
            }}
            disabled={disabled || busy}
          />
          <Button
            size="sm"
            variant="secondary"
            onClick={onRename}
            disabled={disabled || busy || !renameName.trim()}
          >
            Rename
          </Button>
          <Button
            size="sm"
            variant="secondary"
            onClick={openDuplicateDialog}
            disabled={disabled || busy}
          >
            Duplicate
          </Button>
          <Button size="sm" variant="ghost" onClick={openDeleteDialog} disabled={disabled || busy}>
            Delete
          </Button>
        </div>
      )}

      {error && <p className="text-xs text-destructive">{error}</p>}

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
