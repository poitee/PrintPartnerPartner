import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Check, X } from "lucide-react";
import {
  dismissPrinterCheckoff,
  fetchPrintOutcomesSummary,
  fetchPrinterCheckoffLinks,
  verifyPrinterCheckoff,
  type PrintOutcomesSummary,
  type PrintRejectReason,
  type PrinterCheckoffLink,
  type ReviewPart,
} from "../../api/engine";
import { Button } from "../ui/button";
import { cn } from "../../lib/utils";

const REJECT_REASONS: { value: PrintRejectReason; label: string }[] = [
  { value: "bed_adhesion", label: "Bed adhesion" },
  { value: "layer_shift", label: "Layer shift" },
  { value: "warping", label: "Warping" },
  { value: "stringing", label: "Stringing" },
  { value: "under_extrusion", label: "Under-extrusion" },
  { value: "over_extrusion", label: "Over-extrusion" },
  { value: "dimensional", label: "Dimensional" },
  { value: "collision", label: "Collision / knock" },
  { value: "wrong_filament", label: "Wrong filament" },
  { value: "other", label: "Other" },
];

type Props = {
  engineReady: boolean;
  profileId: number | null;
  parts: ReviewPart[];
  refreshKey?: number;
  onVerified?: () => void;
  className?: string;
};

function unitKey(partId: number, unitIndex: number): string {
  return `${partId}:${unitIndex}`;
}

function pendingUnits(link: PrinterCheckoffLink) {
  const done = new Set(
    (link.resolved_units ?? []).map((u) => unitKey(u.part_id, u.unit_index)),
  );
  return link.units.filter((u) => !done.has(unitKey(u.part_id, u.unit_index)));
}

/**
 * Verify-first Progress panel: confirm or reject units after host job success.
 */
export default function PrintVerifyPanel({
  engineReady,
  profileId,
  parts,
  refreshKey = 0,
  onVerified,
  className,
}: Props) {
  const [links, setLinks] = useState<PrinterCheckoffLink[]>([]);
  const [failedLinks, setFailedLinks] = useState<PrinterCheckoffLink[]>([]);
  const [summary, setSummary] = useState<PrintOutcomesSummary | null>(null);
  const [busy, setBusy] = useState(false);
  const [rejectTarget, setRejectTarget] = useState<{
    linkId: string;
    partId: number;
    unitIndex: number;
  } | null>(null);
  const [rejectReason, setRejectReason] = useState<PrintRejectReason>("bed_adhesion");
  const [rejectNote, setRejectNote] = useState("");

  const partsById = useMemo(() => new Map(parts.map((p) => [p.id, p])), [parts]);

  const reload = useCallback(async () => {
    if (!engineReady || profileId == null) {
      setLinks([]);
      setFailedLinks([]);
      setSummary(null);
      return;
    }
    try {
      const [awaiting, failed, outcomes] = await Promise.all([
        fetchPrinterCheckoffLinks({ state: "awaiting_verify", profile_id: profileId }),
        fetchPrinterCheckoffLinks({ state: "host_failed", profile_id: profileId }),
        fetchPrintOutcomesSummary(profileId),
      ]);
      setLinks(awaiting.links);
      setFailedLinks(failed.links);
      setSummary(outcomes);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  }, [engineReady, profileId]);

  useEffect(() => {
    void reload();
  }, [reload, refreshKey]);

  const runVerify = async (
    linkId: string,
    decisions: Parameters<typeof verifyPrinterCheckoff>[0]["decisions"],
  ) => {
    setBusy(true);
    try {
      const result = await verifyPrinterCheckoff({ link_id: linkId, decisions });
      if (result.units_confirmed > 0) {
        toast.success(
          `Confirmed ${result.units_confirmed} unit${result.units_confirmed === 1 ? "" : "s"} printed`,
        );
      }
      if (result.units_rejected > 0) {
        toast.message(
          `Logged ${result.units_rejected} reject${result.units_rejected === 1 ? "" : "s"}`,
        );
      }
      setRejectTarget(null);
      setRejectNote("");
      await reload();
      onVerified?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const onConfirmUnit = (link: PrinterCheckoffLink, partId: number, unitIndex: number) => {
    void runVerify(link.id, [{ part_id: partId, unit_index: unitIndex, result: "confirmed" }]);
  };

  const onConfirmAll = (link: PrinterCheckoffLink) => {
    const pending = pendingUnits(link);
    if (!pending.length) return;
    void runVerify(
      link.id,
      pending.map((u) => ({
        part_id: u.part_id,
        unit_index: u.unit_index,
        result: "confirmed" as const,
      })),
    );
  };

  const onSubmitReject = () => {
    if (!rejectTarget) return;
    void runVerify(rejectTarget.linkId, [
      {
        part_id: rejectTarget.partId,
        unit_index: rejectTarget.unitIndex,
        result: "rejected",
        reason: rejectReason,
        note: rejectNote.trim() || undefined,
      },
    ]);
  };

  const onDismissFailed = async (linkId: string) => {
    setBusy(true);
    try {
      await dismissPrinterCheckoff({ link_id: linkId });
      await reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  if (!engineReady || profileId == null) return null;
  if (!links.length && !failedLinks.length && !(summary && summary.total_rejected > 0)) {
    return null;
  }

  const topReasons = summary
    ? Object.entries(summary.by_reason)
        .sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0))
        .slice(0, 3)
    : [];

  return (
    <div className={cn("flex flex-col gap-2 print:hidden", className)}>
      {failedLinks.map((link) => (
        <div
          key={link.id}
          className="rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm"
          role="status"
        >
          <div className="flex flex-wrap items-center gap-2">
            <span className="min-w-0 flex-1 font-medium text-destructive">
              {link.host_name}{" "}
              {link.host_outcome === "cancelled" ? "cancelled" : "failed"}{" "}
              <span className="font-mono">{link.filename}</span>
            </span>
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => void onDismissFailed(link.id)}
            >
              Dismiss
            </Button>
          </div>
        </div>
      ))}

      {links.map((link) => {
        const pending = pendingUnits(link);
        return (
          <div
            key={link.id}
            className="rounded-lg border border-emerald-500/35 bg-emerald-500/10 px-3 py-3 text-sm"
            role="region"
            aria-label={`Verify print ${link.filename}`}
          >
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <div className="min-w-0 flex-1">
                <p className="font-medium text-foreground">
                  Verify print · {link.host_name}
                </p>
                <p className="text-xs text-muted-foreground">
                  <span className="font-mono">{link.filename}</span>
                  {" · "}
                  {pending.length} unit{pending.length === 1 ? "" : "s"} left
                </p>
              </div>
              {pending.length > 1 && (
                <Button
                  size="sm"
                  disabled={busy}
                  onClick={() => onConfirmAll(link)}
                >
                  Confirm all remaining
                </Button>
              )}
            </div>
            <ul className="space-y-1.5">
              {pending.map((u) => {
                const part = partsById.get(u.part_id);
                const label = part?.filename ?? `Part #${u.part_id}`;
                return (
                  <li
                    key={unitKey(u.part_id, u.unit_index)}
                    className="flex flex-wrap items-center gap-2 rounded-md border border-border/60 bg-background/70 px-2 py-1.5"
                  >
                    <span className="min-w-0 flex-1 truncate">
                      <span className="font-medium">{label}</span>
                      <span className="text-muted-foreground">
                        {" "}
                        · unit {u.unit_index + 1}
                        {part?.role ? ` · ${part.role}` : ""}
                      </span>
                    </span>
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={busy}
                      onClick={() => onConfirmUnit(link, u.part_id, u.unit_index)}
                    >
                      <Check className="mr-1 h-3.5 w-3.5" aria-hidden />
                      Confirm
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy}
                      onClick={() =>
                        setRejectTarget({
                          linkId: link.id,
                          partId: u.part_id,
                          unitIndex: u.unit_index,
                        })
                      }
                    >
                      <X className="mr-1 h-3.5 w-3.5" aria-hidden />
                      Reject…
                    </Button>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}

      {rejectTarget && (
        <div
          className="rounded-lg border border-border bg-card px-3 py-3 text-sm shadow-sm"
          role="dialog"
          aria-label="Reject print unit"
        >
          <p className="mb-2 font-medium">Why did this unit fail?</p>
          <select
            className="mb-2 min-h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value as PrintRejectReason)}
            aria-label="Reject reason"
          >
            {REJECT_REASONS.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </select>
          <input
            type="text"
            className="mb-2 min-h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
            placeholder="Optional note"
            value={rejectNote}
            onChange={(e) => setRejectNote(e.target.value)}
            maxLength={500}
          />
          <div className="flex flex-wrap gap-2">
            <Button size="sm" disabled={busy} onClick={onSubmitReject}>
              Save reject
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={() => setRejectTarget(null)}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}

      {topReasons.length > 0 && (
        <div className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
          <span className="font-medium text-foreground">Recent print issues: </span>
          {topReasons.map(([reason, count], i) => (
            <span key={reason}>
              {i > 0 ? " · " : ""}
              {REJECT_REASONS.find((r) => r.value === reason)?.label ?? reason} ({count})
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
