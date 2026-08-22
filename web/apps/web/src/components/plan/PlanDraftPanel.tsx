import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  EngineHttpError,
  type ApplyPlanDraftReceipt,
  type PlanDraftWorkspace,
  type RequiredUnitDecisionContract,
} from "../../api/engine";
import { Button } from "../ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../ui/card";

export function planDraftRevisionPartLabels(
  workspace: PlanDraftWorkspace,
): ReadonlyMap<number, string> {
  const labels = new Map<number, string>();
  for (const part of workspace.parts) {
    if (part.base_revision_part_id != null) {
      labels.set(part.base_revision_part_id, part.filename);
    }
  }
  for (const change of workspace.diff.changed) {
    labels.set(change.before.revision_part_id, change.before.filename);
  }
  for (const part of workspace.diff.removed) {
    labels.set(part.revision_part_id, part.filename);
  }
  return labels;
}

export function PlanDraftApplyButton({
  workspace,
  busy,
  onApply,
  onRebase,
}: {
  workspace: PlanDraftWorkspace;
  busy: boolean;
  onApply: () => void;
  onRebase: () => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {!workspace.diff.base_is_current && (
        <Button
          type="button"
          variant="secondary"
          disabled={busy}
          onClick={onRebase}
        >
          Rebase saved draft
        </Button>
      )}
      <Button
        type="button"
        disabled={
          busy ||
          !workspace.diff.base_is_current ||
          workspace.reconciliation.kind !== "ready"
        }
        loading={busy}
        onClick={onApply}
      >
        Apply plan changes
      </Button>
    </div>
  );
}

type Props = {
  workspace: PlanDraftWorkspace | null;
  error?: string | null;
  apply: (options?: { remapCheckoffLinks?: boolean }) => Promise<ApplyPlanDraftReceipt>;
  rebase: () => Promise<PlanDraftWorkspace>;
  reconcile: (decisions: RequiredUnitDecisionContract[]) => Promise<PlanDraftWorkspace>;
};

/** Print-progress records that blocked a checkoff-remap Apply attempt. */
type ProductionBlock = {
  readonly checkoffLinkCount: number;
  readonly sendQueueItemCount: number;
};

function productionBlockFromError(caught: unknown): ProductionBlock | null {
  if (!(caught instanceof EngineHttpError) || caught.status !== 423) return null;
  const body = caught.body as { code?: string; checkoff_link_count?: number; send_queue_item_count?: number } | null;
  if (!body || body.code !== "production_active") return null;
  return {
    checkoffLinkCount: body.checkoff_link_count ?? 0,
    sendQueueItemCount: body.send_queue_item_count ?? 0,
  };
}

/** Plan-owned Apply, rebase, and Required-unit conflict resolution. */
export default function PlanDraftPanel({
  workspace,
  error,
  apply,
  rebase,
  reconcile,
}: Props) {
  const [busy, setBusy] = useState(false);
  const [conflictChoices, setConflictChoices] = useState<Record<string, string>>({});
  const [productionBlock, setProductionBlock] = useState<ProductionBlock | null>(null);

  useEffect(() => {
    setConflictChoices({});
    setProductionBlock(null);
  }, [workspace?.draft.snapshot_digest]);

  const acceptedRevisionPartLabels = useMemo(
    () => (workspace ? planDraftRevisionPartLabels(workspace) : new Map<number, string>()),
    [workspace],
  );
  const proposedPartChanges = useMemo(
    () =>
      workspace
        ? [
            ...workspace.diff.added.map((part) => ({
              part,
              label: "Added",
              fields: [] as string[],
            })),
            ...workspace.diff.changed.map((change) => ({
              part: change.after,
              label: "Changed",
              fields: change.fields,
            })),
          ]
        : [],
    [workspace],
  );

  if (!workspace && !error) return null;

  const onApply = async (options?: { remapCheckoffLinks?: boolean }) => {
    setBusy(true);
    try {
      const receipt = await apply(options);
      setProductionBlock(null);
      toast.success(`Applied Plan version ${receipt.plan_version}`);
    } catch (caught) {
      const block = productionBlockFromError(caught);
      if (block) {
        setProductionBlock(block);
        toast.error(
          `${block.checkoffLinkCount} checkoff record(s) are linked to the current Plan. Remap and apply to preserve them, or resolve production first.`,
        );
      } else {
        toast.error(caught instanceof Error ? caught.message : String(caught));
      }
    } finally {
      setBusy(false);
    }
  };

  const onRebase = async () => {
    setBusy(true);
    try {
      const next = await rebase();
      toast.success(`Rebased saved draft ${next.draft.draft_id}`);
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  };

  const onResolve = async () => {
    if (!workspace || workspace.reconciliation.kind !== "unresolved") return;
    const decisions: RequiredUnitDecisionContract[] = [];
    for (const conflict of workspace.reconciliation.conflicts) {
      const key = `${conflict.kind}:${conflict.target_draft_part_id}`;
      const choice = conflictChoices[key];
      if (!choice) {
        toast.error("Choose how to resolve every Required-unit conflict");
        return;
      }
      if (choice === "replace") {
        decisions.push({ kind: "replace", target_draft_part_id: conflict.target_draft_part_id });
      } else if (conflict.kind === "ambiguous_exact_match") {
        decisions.push({
          kind: "select_exact_predecessor",
          target_draft_part_id: conflict.target_draft_part_id,
          predecessor_revision_part_id: Number(choice),
        });
      } else {
        decisions.push({
          kind: "accept_prior_completion",
          target_draft_part_id: conflict.target_draft_part_id,
          predecessor_revision_part_id: conflict.predecessor_revision_part_id,
        });
      }
    }
    setBusy(true);
    try {
      await reconcile(decisions);
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      {workspace && (
        <Card className="border-primary/40">
          <CardHeader className="pb-2">
            <CardTitle level={3} className="text-base">Saved Plan draft</CardTitle>
            <CardDescription>
              Accepted Parts and Checkoff stay unchanged until you apply this draft.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm">
              {workspace.diff.added.length} added, {workspace.diff.changed.length} changed, {workspace.diff.removed.length} removed
            </p>
            {(proposedPartChanges.length > 0 || workspace.diff.removed.length > 0) && (
              <div className="overflow-x-auto rounded-md border border-border">
                <table className="w-full text-left text-sm">
                  <thead className="bg-muted/40 text-xs text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2 font-medium">Proposed Part</th>
                      <th className="px-3 py-2 font-medium">Change</th>
                      <th className="px-3 py-2 font-medium">Proposed qty</th>
                      <th className="px-3 py-2 font-medium">Proposed inclusion</th>
                    </tr>
                  </thead>
                  <tbody>
                    {proposedPartChanges.map(({ part, label, fields }) => (
                      <tr key={`proposed-${part.draft_part_id}`} className="border-t border-border">
                        <td className="px-3 py-2">
                          <span className="font-medium">{part.filename}</span>
                          <span className="block text-xs text-muted-foreground">{part.relative_path}</span>
                        </td>
                        <td className="px-3 py-2">
                          {label}{fields.length > 0 ? `: ${fields.join(", ")}` : ""}
                        </td>
                        <td className="px-3 py-2">{part.quantity_effective}</td>
                        <td className="px-3 py-2">{part.included ? "Included" : "Excluded"}</td>
                      </tr>
                    ))}
                    {workspace.diff.removed.map((part) => (
                      <tr key={`removed-${part.revision_part_id}`} className="border-t border-border">
                        <td className="px-3 py-2">
                          <span className="font-medium">{part.filename}</span>
                          <span className="block text-xs text-muted-foreground">{part.relative_path}</span>
                        </td>
                        <td className="px-3 py-2">Removed</td>
                        <td className="px-3 py-2">Not applicable</td>
                        <td className="px-3 py-2">Removed</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {!workspace.diff.base_is_current && (
              <p className="text-sm text-destructive" role="alert">
                The accepted Plan changed after this draft was saved. Rebase it before applying.
              </p>
            )}
            {workspace.reconciliation.kind === "unresolved" && (
              <div className="space-y-2 rounded-md border border-warning/40 bg-warning/5 p-3">
                <p className="text-sm">
                  Resolve {workspace.reconciliation.conflicts.length} Required-unit conflict(s) before Apply.
                </p>
                <div className="space-y-2">
                  {workspace.reconciliation.conflicts.map((conflict) => {
                    const key = `${conflict.kind}:${conflict.target_draft_part_id}`;
                    const target = workspace.parts.find(
                      (part) => part.draft_part_id === conflict.target_draft_part_id,
                    );
                    return (
                      <label key={key} className="block space-y-1 text-sm">
                        <span className="block font-medium">
                          {target?.filename ?? `Draft Part ${conflict.target_draft_part_id}`}
                        </span>
                        <select
                          className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                          value={conflictChoices[key] ?? ""}
                          disabled={busy}
                          onChange={(event) => setConflictChoices((current) => ({
                            ...current,
                            [key]: event.target.value,
                          }))}
                        >
                          <option value="">Choose a resolution</option>
                          {conflict.kind === "ambiguous_exact_match" && conflict.candidate_revision_part_ids.map((candidateId) => (
                            <option key={candidateId} value={String(candidateId)}>
                              Reuse {acceptedRevisionPartLabels.get(candidateId) ?? `accepted Part ${candidateId}`}
                            </option>
                          ))}
                          {conflict.kind === "unsafe_predecessor" && (
                            <option value={String(conflict.predecessor_revision_part_id)}>
                              Keep prior completed units
                            </option>
                          )}
                          <option value="replace">Print as new units</option>
                        </select>
                      </label>
                    );
                  })}
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    disabled={busy || workspace.reconciliation.conflicts.some((conflict) => (
                      !conflictChoices[`${conflict.kind}:${conflict.target_draft_part_id}`]
                    ))}
                    onClick={() => void onResolve()}
                  >
                    Save conflict decisions
                  </Button>
                </div>
              </div>
            )}
            {productionBlock && (
              <div className="space-y-2 rounded-md border border-destructive/40 bg-destructive/5 p-3">
                <p className="text-sm text-destructive" role="alert">
                  {productionBlock.checkoffLinkCount} checkoff record(s)
                  {productionBlock.sendQueueItemCount > 0
                    ? ` and ${productionBlock.sendQueueItemCount} send-queue item(s)`
                    : ""}{" "}
                  are linked to the current accepted Plan. Applying this draft normally is blocked to
                  avoid losing that print-progress data.
                </p>
                <p className="text-sm text-muted-foreground">
                  Remap and apply re-points those checkoff records onto the matching parts in this
                  draft (matched by STL identity) so printed counts are preserved. If any checked-off
                  file was removed or its printed count now exceeds the new quantity, Apply will fail
                  with the specific item(s) to resolve first.
                </p>
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  disabled={busy}
                  loading={busy}
                  onClick={() => void onApply({ remapCheckoffLinks: true })}
                >
                  Remap and apply
                </Button>
              </div>
            )}
            <PlanDraftApplyButton
              workspace={workspace}
              busy={busy}
              onApply={() => void onApply()}
              onRebase={() => void onRebase()}
            />
          </CardContent>
        </Card>
      )}
      {error && (
        <p className="text-sm text-destructive" role="alert">{error}</p>
      )}
    </>
  );
}
