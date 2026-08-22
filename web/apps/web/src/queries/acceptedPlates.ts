import {
  useIsMutating,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import type {
  AcceptedPlanBasisContract,
  AcceptedPlateExportRecord,
  AcceptedPlateMoveReceipt,
  AcceptedPlateWorkspace,
  InitializeAcceptedPlatesRequest,
  MoveAcceptedPlateUnitRequest,
  PinAcceptedPlateUnitRequest,
  ArrangeAcceptedPlatesRequest,
  RestoreAcceptedPlatesRequest,
  UnplaceAcceptedPlateUnitRequest,
  TransferAcceptedPlateUnitRequest,
} from "@print-partner/contracts";
import {
  fetchAcceptedPlateExportJobs,
  fetchAcceptedPlateWorkspace,
  initializeAcceptedPlates,
  moveAcceptedPlateUnit,
  pinAcceptedPlateUnit,
  arrangeAcceptedPlates,
  restoreAcceptedPlates,
  unplaceAcceptedPlateUnit,
  transferAcceptedPlateUnit,
} from "../api/endpoints/acceptedPlates";
import { queryKeys } from "./keys";

export type AcceptedPlateCapability =
  | {
      readonly kind: "blocked";
      readonly reason:
        | "disabled"
        | "loading"
        | "load_failed"
        | "empty_plan"
        | "needs_arrangement"
        | "revision_write_pending";
    }
  | {
      readonly kind: "ready";
      readonly profileId: number;
      readonly basis: AcceptedPlanBasisContract;
      readonly plateRevisionId: number;
      readonly plateRevisionNumber: number;
    };

type CapabilityInput = Readonly<{
  enabled: boolean;
  profileId: number | null;
  workspace: AcceptedPlateWorkspace | undefined;
  isPending: boolean;
  isError: boolean;
  revisionWritePending: boolean;
}>;

export type AcceptedPlateMoveVariables = Readonly<{
  plateId: string;
  token: string;
  input: MoveAcceptedPlateUnitRequest;
}>;

export type AcceptedPlateUnplaceVariables = Readonly<{
  plateId: string;
  token: string;
  input: UnplaceAcceptedPlateUnitRequest;
}>;

export type AcceptedPlateTransferVariables = Readonly<{
  plateId: string;
  token: string;
  input: TransferAcceptedPlateUnitRequest;
}>;

export type AcceptedPlatePinVariables = Readonly<{
  plateId: string;
  token: string;
  input: PinAcceptedPlateUnitRequest;
}>;

export function publishAcceptedPlateUnplace(
  workspace: AcceptedPlateWorkspace | undefined,
  variables: AcceptedPlateUnplaceVariables,
  receipt: AcceptedPlateMoveReceipt,
): AcceptedPlateWorkspace | undefined {
  if (workspace?.kind !== "ready") return workspace;
  const plate = workspace.plates.find((candidate) => candidate.plate_id === variables.plateId);
  const unit = plate?.units.find((candidate) => candidate.token === variables.token);
  if (!plate || !unit) return workspace;
  return {
    ...workspace,
    plate_revision_id: receipt.plate_revision_id,
    plate_revision_number: receipt.plate_revision_number,
    plates: workspace.plates.map((candidate) => candidate.plate_id !== variables.plateId
      ? candidate
      : { ...candidate, units: candidate.units.filter((item) => item.token !== variables.token) }),
    unplaced: [
      ...workspace.unplaced,
      {
        token: unit.token,
        object_name: unit.object_name,
        filename: unit.filename,
        source_layer: unit.source_layer,
        role: unit.role,
        filament_color_id: unit.filament_color_id,
        plate_id: plate.plate_id,
        printer_id: plate.printer.id,
        width_um: unit.width_um,
        depth_um: unit.depth_um,
        height_um: unit.height_um,
      },
    ],
  };
}

export function publishAcceptedPlatePin(
  workspace: AcceptedPlateWorkspace | undefined,
  variables: AcceptedPlatePinVariables,
  receipt: AcceptedPlateMoveReceipt,
): AcceptedPlateWorkspace | undefined {
  if (workspace?.kind !== "ready") return workspace;
  return {
    ...workspace,
    plate_revision_id: receipt.plate_revision_id,
    plate_revision_number: receipt.plate_revision_number,
    plates: workspace.plates.map((plate) => plate.plate_id !== variables.plateId
      ? plate
      : {
          ...plate,
          units: plate.units.map((unit) => unit.token !== variables.token
            ? unit
            : {
                ...unit,
                placement: variables.input.pinned
                  ? "pinned"
                  : unit.placement === "pinned" ? "manual" : unit.placement,
              }),
        }),
  };
}

export function acceptedPlateMutationKey(profileId: number) {
  return ["acceptedPlateRevision", profileId] as const;
}

export function acceptedPlateMutationScope(profileId: number) {
  return { id: `accepted-plate-revision:${profileId}` };
}

export function acceptedPlateCapability(input: CapabilityInput): AcceptedPlateCapability {
  if (!input.enabled || input.profileId == null || input.profileId <= 0) {
    return { kind: "blocked", reason: "disabled" };
  }
  if (input.revisionWritePending) return { kind: "blocked", reason: "revision_write_pending" };
  if (input.workspace?.kind === "ready") {
    return {
      kind: "ready",
      profileId: input.profileId,
      basis: input.workspace.basis,
      plateRevisionId: input.workspace.plate_revision_id,
      plateRevisionNumber: input.workspace.plate_revision_number,
    };
  }
  if (input.workspace?.kind === "empty_plan") return { kind: "blocked", reason: "empty_plan" };
  if (input.workspace?.kind === "setup") return { kind: "blocked", reason: "needs_arrangement" };
  if (input.isPending) return { kind: "blocked", reason: "loading" };
  if (input.isError) return { kind: "blocked", reason: "load_failed" };
  return { kind: "blocked", reason: "loading" };
}

export function publishAcceptedPlateMove(
  workspace: AcceptedPlateWorkspace | undefined,
  variables: AcceptedPlateMoveVariables,
  receipt: AcceptedPlateMoveReceipt,
): AcceptedPlateWorkspace | undefined {
  if (workspace?.kind !== "ready") return workspace;
  return {
    ...workspace,
    plate_revision_id: receipt.plate_revision_id,
    plate_revision_number: receipt.plate_revision_number,
    plates: workspace.plates.map((plate) => plate.plate_id !== variables.plateId
      ? plate
      : {
          ...plate,
          units: plate.units.map((unit) => unit.token !== variables.token
            ? unit
            : { ...unit, x_um: variables.input.x_um, y_um: variables.input.y_um, placement: unit.placement === "pinned" ? "pinned" : "manual" }),
        }),
  };
}

export function invalidateAcceptedPlateWorkspace(queryClient: QueryClient, profileId: number) {
  return queryClient.invalidateQueries({ queryKey: queryKeys.acceptedPlateWorkspace(profileId) });
}

export function invalidateAcceptedPlateExportJobs(queryClient: QueryClient, profileId: number) {
  return queryClient.invalidateQueries({ queryKey: queryKeys.acceptedPlateExportJobs(profileId) });
}

export function useAcceptedPlateWorkspaceQuery(profileId: number | null, enabled = true) {
  return useQuery({
    queryKey: queryKeys.acceptedPlateWorkspace(profileId ?? 0),
    queryFn: () => fetchAcceptedPlateWorkspace(profileId ?? 0),
    enabled: enabled && profileId != null && profileId > 0,
  });
}

export function useAcceptedPlateExportJobsQuery(profileId: number | null, enabled = true) {
  return useQuery<readonly AcceptedPlateExportRecord[]>({
    queryKey: queryKeys.acceptedPlateExportJobs(profileId ?? 0),
    queryFn: () => fetchAcceptedPlateExportJobs(profileId ?? 0),
    enabled: enabled && profileId != null && profileId > 0,
    refetchInterval: (query) => acceptedPlateHistoryNeedsPolling(query.state.data) ? 1_000 : false,
  });
}

export function acceptedPlateHistoryNeedsPolling(
  records: readonly AcceptedPlateExportRecord[] | undefined,
): boolean {
  return records?.some((record) => record.status === "pending" || record.status === "running") ?? false;
}

export function useAcceptedPlateRevisionPending(profileId: number | null): boolean {
  return useIsMutating({
    mutationKey: acceptedPlateMutationKey(profileId ?? 0),
    exact: true,
  }) > 0;
}

export function useInitializeAcceptedPlatesMutation(profileId: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: acceptedPlateMutationKey(profileId),
    scope: acceptedPlateMutationScope(profileId),
    retry: false,
    mutationFn: (input: InitializeAcceptedPlatesRequest) => initializeAcceptedPlates(profileId, input),
    onSuccess: (workspace) => {
      queryClient.setQueryData(queryKeys.acceptedPlateWorkspace(profileId), workspace);
    },
  });
}

export function useMoveAcceptedPlateUnitMutation(profileId: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: acceptedPlateMutationKey(profileId),
    scope: acceptedPlateMutationScope(profileId),
    retry: false,
    mutationFn: (variables: AcceptedPlateMoveVariables) => moveAcceptedPlateUnit(
      profileId,
      variables.plateId,
      variables.token,
      variables.input,
    ),
    onSuccess: async (receipt, variables) => {
      queryClient.setQueryData<AcceptedPlateWorkspace>(
        queryKeys.acceptedPlateWorkspace(profileId),
        (workspace) => publishAcceptedPlateMove(workspace, variables, receipt),
      );
      await invalidateAcceptedPlateWorkspace(queryClient, profileId);
    },
  });
}

export function usePinAcceptedPlateUnitMutation(profileId: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: acceptedPlateMutationKey(profileId),
    scope: acceptedPlateMutationScope(profileId),
    retry: false,
    mutationFn: (variables: AcceptedPlatePinVariables) => pinAcceptedPlateUnit(
      profileId,
      variables.plateId,
      variables.token,
      variables.input,
    ),
    onSuccess: async (receipt, variables) => {
      queryClient.setQueryData<AcceptedPlateWorkspace>(
        queryKeys.acceptedPlateWorkspace(profileId),
        (workspace) => publishAcceptedPlatePin(workspace, variables, receipt),
      );
      await invalidateAcceptedPlateWorkspace(queryClient, profileId);
    },
  });
}

export function useUnplaceAcceptedPlateUnitMutation(profileId: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: acceptedPlateMutationKey(profileId),
    scope: acceptedPlateMutationScope(profileId),
    retry: false,
    mutationFn: (variables: AcceptedPlateUnplaceVariables) => unplaceAcceptedPlateUnit(
      profileId,
      variables.plateId,
      variables.token,
      variables.input,
    ),
    onSuccess: async (receipt, variables) => {
      queryClient.setQueryData<AcceptedPlateWorkspace>(
        queryKeys.acceptedPlateWorkspace(profileId),
        (workspace) => publishAcceptedPlateUnplace(workspace, variables, receipt),
      );
      await invalidateAcceptedPlateWorkspace(queryClient, profileId);
    },
  });
}

export function useTransferAcceptedPlateUnitMutation(profileId: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: acceptedPlateMutationKey(profileId),
    scope: acceptedPlateMutationScope(profileId),
    retry: false,
    mutationFn: (variables: AcceptedPlateTransferVariables) => transferAcceptedPlateUnit(
      profileId,
      variables.plateId,
      variables.token,
      variables.input,
    ),
    onSuccess: async () => {
      await invalidateAcceptedPlateWorkspace(queryClient, profileId);
    },
  });
}

export function useArrangeAcceptedPlatesMutation(profileId: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: acceptedPlateMutationKey(profileId),
    scope: acceptedPlateMutationScope(profileId),
    retry: false,
    mutationFn: (input: ArrangeAcceptedPlatesRequest) => arrangeAcceptedPlates(profileId, input),
    onSuccess: (workspace) => {
      queryClient.setQueryData(queryKeys.acceptedPlateWorkspace(profileId), workspace);
    },
  });
}

export function useRestoreAcceptedPlatesMutation(profileId: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: acceptedPlateMutationKey(profileId),
    scope: acceptedPlateMutationScope(profileId),
    retry: false,
    mutationFn: (input: RestoreAcceptedPlatesRequest) => restoreAcceptedPlates(profileId, input),
    onSuccess: (workspace) => {
      queryClient.setQueryData(queryKeys.acceptedPlateWorkspace(profileId), workspace);
    },
  });
}
