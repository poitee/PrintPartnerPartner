import { useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import {
  parseAcceptedPlateId,
  type AcceptedPlateWorkspace,
  type InitializeAcceptedPlatesRequest,
} from "@print-partner/contracts";
import { isAcceptedPlateStaleError } from "../../../api/endpoints/acceptedPlates";
import {
  invalidateAcceptedPlateWorkspace,
  useAcceptedPlateRevisionPending,
  useAcceptedPlateWorkspaceQuery,
  useArrangeAcceptedPlatesMutation,
  useInitializeAcceptedPlatesMutation,
  useMoveAcceptedPlateUnitMutation,
  usePinAcceptedPlateUnitMutation,
  useRestoreAcceptedPlatesMutation,
  useTransferAcceptedPlateUnitMutation,
  useUnplaceAcceptedPlateUnitMutation,
} from "../../../queries/acceptedPlates";
import { printersSetupRoute } from "../../../lib/routes";
import { Button } from "../../ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../../ui/card";
import AcceptedPlateAssignmentForm from "./AcceptedPlateAssignmentForm";
import AcceptedPlateGallery, { UNUSED_PRINTER_TRANSFER_PREFIX } from "./AcceptedPlateGallery";

type Props = Readonly<{
  profileId: number;
  enabled: boolean;
}>;

function assignmentIdentity(
  workspace: Extract<AcceptedPlateWorkspace, { kind: "setup" | "ready" }>,
) {
  const basis = workspace.basis;
  const head = workspace.kind === "ready" ? workspace.plate_revision_id : workspace.expected_plate_revision_id;
  return [
    basis.profile_id,
    basis.plan_revision_id,
    basis.plan_version,
    basis.plan_revision_digest,
    basis.required_unit_mapping_digest,
    head ?? "none",
  ].join(":");
}

export default function AcceptedPlateSection({ profileId, enabled }: Props) {
  const queryClient = useQueryClient();
  const query = useAcceptedPlateWorkspaceQuery(profileId, enabled);
  const initialize = useInitializeAcceptedPlatesMutation(profileId);
  const move = useMoveAcceptedPlateUnitMutation(profileId);
  const pin = usePinAcceptedPlateUnitMutation(profileId);
  const unplace = useUnplaceAcceptedPlateUnitMutation(profileId);
  const transfer = useTransferAcceptedPlateUnitMutation(profileId);
  const arrange = useArrangeAcceptedPlatesMutation(profileId);
  const restore = useRestoreAcceptedPlatesMutation(profileId);
  const revisionWritePending = useAcceptedPlateRevisionPending(profileId);
  const [reassigning, setReassigning] = useState(false);
  const workspace = query.data;

  const submitAssignments = async (request: InitializeAcceptedPlatesRequest) => {
    try {
      await initialize.mutateAsync(request);
      setReassigning(false);
    } catch (error) {
      if (isAcceptedPlateStaleError(error)) {
        setReassigning(false);
        await invalidateAcceptedPlateWorkspace(queryClient, profileId);
        toast.error("Newer accepted Plate state replaced these assignments.");
        return;
      }
      toast.error(error instanceof Error ? error.message : "Could not arrange accepted Plates.");
    }
  };

  const submitMove = async (plateId: string, token: string, xUm: number, yUm: number) => {
    if (workspace?.kind !== "ready") return;
    try {
      await move.mutateAsync({
        plateId,
        token,
        input: {
          expected: workspace.basis,
          expected_plate_revision_id: workspace.plate_revision_id,
          x_um: xUm,
          y_um: yUm,
        },
      });
      return true;
    } catch (error) {
      if (isAcceptedPlateStaleError(error)) return false;
      toast.error(error instanceof Error ? error.message : "Could not move this Required unit.");
      throw error;
    }
  };

  const submitPin = async (plateId: string, token: string, pinned: boolean) => {
    if (workspace?.kind !== "ready") return;
    try {
      await pin.mutateAsync({
        plateId,
        token,
        input: {
          expected: workspace.basis,
          expected_plate_revision_id: workspace.plate_revision_id,
          pinned,
        },
      });
    } catch (error) {
      if (isAcceptedPlateStaleError(error)) {
        await refreshAfterStaleMove();
        return;
      }
      toast.error(error instanceof Error ? error.message : "Could not pin this Required unit.");
    }
  };

  const submitUnplace = async (plateId: string, token: string) => {
    if (workspace?.kind !== "ready") return;
    try {
      await unplace.mutateAsync({
        plateId,
        token,
        input: {
          expected: workspace.basis,
          expected_plate_revision_id: workspace.plate_revision_id,
        },
      });
    } catch (error) {
      if (isAcceptedPlateStaleError(error)) {
        await refreshAfterStaleMove();
        return;
      }
      toast.error(error instanceof Error ? error.message : "Could not return this Required unit to unplaced.");
    }
  };

  const submitTransfer = async (plateId: string, token: string, target: string) => {
    if (workspace?.kind !== "ready") return;
    try {
      const input = target.startsWith(UNUSED_PRINTER_TRANSFER_PREFIX)
        ? {
            expected: workspace.basis,
            expected_plate_revision_id: workspace.plate_revision_id,
            target_printer_id: target.slice(UNUSED_PRINTER_TRANSFER_PREFIX.length),
          }
        : {
            expected: workspace.basis,
            expected_plate_revision_id: workspace.plate_revision_id,
            target_plate_id: parseAcceptedPlateId(target),
          };
      await transfer.mutateAsync({
        plateId,
        token,
        input,
      });
    } catch (error) {
      if (isAcceptedPlateStaleError(error)) {
        await refreshAfterStaleMove();
        return;
      }
      toast.error(error instanceof Error ? error.message : "Could not move this Required unit to another Plate.");
    }
  };

  const submitArrange = async (mode: "unplaced" | "all") => {
    if (workspace?.kind !== "ready") return;
    try {
      await arrange.mutateAsync({
        expected: workspace.basis,
        expected_plate_revision_id: workspace.plate_revision_id,
        mode,
      });
    } catch (error) {
      if (isAcceptedPlateStaleError(error)) {
        await refreshAfterStaleMove();
        return;
      }
      toast.error(error instanceof Error ? error.message : "Could not arrange Plates.");
    }
  };

  const submitRestore = async () => {
    if (workspace?.kind !== "ready" || workspace.arrange_undo_revision_id == null) return;
    try {
      await restore.mutateAsync({
        expected: workspace.basis,
        expected_plate_revision_id: workspace.plate_revision_id,
        restore_plate_revision_id: workspace.arrange_undo_revision_id,
      });
    } catch (error) {
      if (isAcceptedPlateStaleError(error)) {
        await refreshAfterStaleMove();
        return;
      }
      toast.error(error instanceof Error ? error.message : "Could not undo Arrange all.");
    }
  };

  const refreshAfterStaleMove = async () => {
    await invalidateAcceptedPlateWorkspace(queryClient, profileId);
    toast.error("Newer accepted Plate state replaced this edit.");
  };

  return (
    <Card className="border-border shadow-sm">
      <CardHeader className="gap-1">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <CardTitle level={2}>Plates</CardTitle>
            <CardDescription>
              PrintPartner preserves Source orientation. Rotate parts in your slicer.
            </CardDescription>
          </div>
          {workspace?.kind === "ready" && !reassigning ? (
            <Button variant="outline" size="sm" disabled={revisionWritePending} onClick={() => setReassigning(true)}>
              Change printer assignments
            </Button>
          ) : null}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {query.isPending && !workspace ? <p className="text-sm text-muted-foreground">Loading accepted Plates…</p> : null}
        {query.isError && !workspace ? (
          <div className="space-y-2" role="alert">
            <p className="text-sm text-destructive">Could not load accepted Plates.</p>
            <Button variant="secondary" size="sm" onClick={() => void query.refetch()}>Retry</Button>
          </div>
        ) : null}
        {query.isFetching && workspace ? <p className="text-xs text-muted-foreground">Checking for updates…</p> : null}
        {query.isError && workspace ? (
          <p className="text-sm text-amber-700 dark:text-amber-300" role="alert">
            Could not check for Plate updates. The saved revision remains available.
          </p>
        ) : null}
        {workspace?.kind === "empty_plan" ? (
          <p className="text-sm text-muted-foreground">Apply a Plan with Required units before arranging Plates.</p>
        ) : null}
        {workspace?.kind === "setup" ? (
          <>
            {workspace.printers.length === 0 ? (
              <Link className="text-sm underline" to={printersSetupRoute()}>Add a Printer</Link>
            ) : null}
            <AcceptedPlateAssignmentForm
              key={assignmentIdentity(workspace)}
              workspace={workspace}
              submitting={initialize.isPending}
              onSubmit={submitAssignments}
            />
          </>
        ) : null}
        {workspace?.kind === "ready" && reassigning ? (
          <AcceptedPlateAssignmentForm
            key={assignmentIdentity(workspace)}
            workspace={workspace}
            submitting={initialize.isPending}
            onSubmit={submitAssignments}
            onCancel={() => setReassigning(false)}
          />
        ) : null}
        {workspace?.kind === "ready" && !reassigning ? (
          <AcceptedPlateGallery
            workspace={workspace}
            disabled={revisionWritePending}
            onMove={submitMove}
            onPin={submitPin}
            onUnplace={submitUnplace}
            onTransfer={submitTransfer}
            onArrange={submitArrange}
            onUndoArrangeAll={workspace.arrange_undo_revision_id == null ? undefined : submitRestore}
            onStaleMove={refreshAfterStaleMove}
          />
        ) : null}
      </CardContent>
    </Card>
  );
}
