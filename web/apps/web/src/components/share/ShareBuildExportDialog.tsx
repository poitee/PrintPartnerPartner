import { useState } from "react";
import { toast } from "sonner";
import { completeExportDownload } from "../../lib/exportActions";
import { startExportKitBundle } from "../../api/engine";
import { useJobRunner } from "../../hooks/useJobRunner";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  profileId: number;
};

export default function ShareBuildExportDialog({ open, onOpenChange, profileId }: Props) {
  const exportJob = useJobRunner("kit-export");
  const [includeProgress, setIncludeProgress] = useState(false);

  const onExport = () => {
    void exportJob.runJob(
      () => startExportKitBundle(profileId, includeProgress),
      (snap) => {
        if (snap.status === "error") {
          toast.error(snap.message || "Export failed");
          return;
        }
        completeExportDownload("Share build", snap.result);
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Share build</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          Config only — no STL files. Exports a portable .print-partner-kit.zip with
          source refs, import rules, included parts, quantities, and filament
          assignments. Recipients need their own synced copies of the repos.
        </p>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={includeProgress}
            onChange={(e) => setIncludeProgress(e.target.checked)}
          />
          <span>Include print progress (done/not-done per unit only)</span>
        </label>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Close
          </Button>
          <Button onClick={onExport} disabled={exportJob.busy}>
            {exportJob.busy ? "Exporting…" : "Export"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
