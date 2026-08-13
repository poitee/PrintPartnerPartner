import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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

export type PrintVerifyQueueState = {
  awaitingCount: number;
  /** Host name for the first awaiting_verify link (header copy). */
  primaryHostName: string | null;
};

type Props = {
  engineReady: boolean;
  profileId: number | null;
  parts: ReviewPart[];
  refreshKey?: number;
  onVerified?: () => void;
  onQueueChange?: (state: PrintVerifyQueueState) => void;
  /** When a live job is printing — hide Confirm/Reject until it finishes. */
  suppressVerifyActions?: boolean;
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
 * Verify-first Progress hero: confirm or reject mapped units after host job success.
 * Primary UI is Confirm / Reject for the finished job — not a per-unit control wall.
 */
export default function PrintVerifyPanel({
  engineReady,
  profileId,
  parts,
  refreshKey = 0,
  onVerified,
  onQueueChange,
  suppressVerifyActions = false,
  className,
}: Props) {
  const [links, setLinks] = useState<PrinterCheckoffLink[]>([]);
  const [failedLinks, setFailedLinks] = useState<PrinterCheckoffLink[]>([]);
  const [summary, setSummary] = useState<PrintOutcomesSummary | null>(null);
  const [busy, setBusy] = useState(false);
  const [rejectTarget, setRejectTarget] = useState<{
    linkId: string;
  } | null>(null);
  const [rejectReason, setRejectReason] = useState<PrintRejectReason>("bed_adhesion");
  const [rejectNote, setRejectNote] = useState("");
  /** Selected pending units per link (compact checklist). Default: all pending. */
  const [selectedByLink, setSelectedByLink] = useState<Record<string, Set<string>>>({});
  const onQueueChangeRef = useRef(onQueueChange);
  onQueueChangeRef.current = onQueueChange;

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

  useEffect(() => {
    onQueueChangeRef.current?.({
      awaitingCount: links.length,
      primaryHostName: links[0]?.host_name ?? null,
    });
  }, [links]);

  useEffect(() => {
    if (suppressVerifyActions) setRejectTarget(null);
  }, [suppressVerifyActions]);

  // Keep checklist selection in sync with pending units (default all selected).
  useEffect(() => {
    setSelectedByLink((prev) => {
      const next: Record<string, Set<string>> = {};
      for (const link of links) {
        const pending = pendingUnits(link);
        const keys = pending.map((u) => unitKey(u.part_id, u.unit_index));
        const prevSet = prev[link.id];
        if (!prevSet) {
          next[link.id] = new Set(keys);
          continue;
        }
        const kept = new Set(keys.filter((k) => prevSet.has(k)));
        // If nothing remains selected but units exist, re-select all (fresh queue).
        next[link.id] = kept.size > 0 || keys.length === 0 ? kept : new Set(keys);
      }
      return next;
    });
  }, [links]);

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

  const selectedPending = (link: PrinterCheckoffLink) => {
    const pending = pendingUnits(link);
    const selected = selectedByLink[link.id];
    if (!selected) return pending;
    return pending.filter((u) => selected.has(unitKey(u.part_id, u.unit_index)));
  };

  const onConfirmSelected = (link: PrinterCheckoffLink) => {
    const units = selectedPending(link);
    if (!units.length) return;
    void runVerify(
      link.id,
      units.map((u) => ({
        part_id: u.part_id,
        unit_index: u.unit_index,
        result: "confirmed" as const,
      })),
    );
  };

  const onSubmitReject = () => {
    if (!rejectTarget) return;
    const link = links.find((l) => l.id === rejectTarget.linkId);
    if (!link) return;
    const units = selectedPending(link);
    if (!units.length) return;
    void runVerify(
      link.id,
      units.map((u) => ({
        part_id: u.part_id,
        unit_index: u.unit_index,
        result: "rejected" as const,
        reason: rejectReason,
        note: rejectNote.trim() || undefined,
      })),
    );
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

  const toggleUnit = (linkId: string, key: string) => {
    setSelectedByLink((prev) => {
      const cur = new Set(prev[linkId] ?? []);
      if (cur.has(key)) cur.delete(key);
      else cur.add(key);
      return { ...prev, [linkId]: cur };
    });
  };

  if (!engineReady || profileId == null) return null;

  const showFailed = failedLinks.length > 0;
  const showVerify = !suppressVerifyActions && links.length > 0;
  const showSummary =
    !suppressVerifyActions && summary != null && summary.total_rejected > 0;

  if (!showFailed && !showVerify && !showSummary) {
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

      {showVerify &&
        links.map((link) => {
          const pending = pendingUnits(link);
          const selected = selectedByLink[link.id] ?? new Set<string>();
          const selectedCount = pending.filter((u) =>
            selected.has(unitKey(u.part_id, u.unit_index)),
          ).length;
          return (
            <div
              key={link.id}
              className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-4 py-4 text-sm shadow-sm"
              role="region"
              aria-label={`Confirm these parts from ${link.filename}`}
            >
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0 flex-1 space-y-1">
                  <p className="text-base font-semibold text-foreground">
                    Confirm these parts
                  </p>
                  <p className="text-sm text-muted-foreground">
                    Mapped from{" "}
                    <span className="font-mono text-foreground">{link.filename}</span>
                    . Confirm marks them printed. Reject leaves them remaining.
                  </p>
                  {pending.length > 0 && (
                    <ul className="mt-2 space-y-1">
                      {pending.map((u) => {
                        const part = partsById.get(u.part_id);
                        const name = part?.filename ?? `Part #${u.part_id}`;
                        const key = unitKey(u.part_id, u.unit_index);
                        const checked = selected.has(key);
                        return (
                          <li key={key}>
                            <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
                              <input
                                type="checkbox"
                                className="size-3.5 rounded border-border"
                                checked={checked}
                                disabled={busy}
                                onChange={() => toggleUnit(link.id, key)}
                              />
                              <span className="min-w-0 truncate">
                                <span className="font-medium text-foreground">{name}</span>
                                {" · unit "}
                                {u.unit_index + 1}
                                {part?.role ? ` · ${part.role}` : ""}
                              </span>
                            </label>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
                <div className="flex shrink-0 flex-wrap gap-2">
                  <Button
                    size="sm"
                    className="min-h-10"
                    disabled={busy || selectedCount === 0}
                    onClick={() => onConfirmSelected(link)}
                  >
                    <Check className="mr-1 h-4 w-4" aria-hidden />
                    Confirm
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="min-h-10"
                    disabled={busy || selectedCount === 0}
                    onClick={() => {
                      setRejectReason("bed_adhesion");
                      setRejectNote("");
                      setRejectTarget({ linkId: link.id });
                    }}
                  >
                    <X className="mr-1 h-4 w-4" aria-hidden />
                    Reject
                  </Button>
                </div>
              </div>
            </div>
          );
        })}

      {rejectTarget && showVerify && (
        <div
          className="rounded-lg border border-border bg-card px-3 py-3 text-sm shadow-sm"
          role="dialog"
          aria-label="Reject print units"
        >
          <p className="mb-2 font-medium">Why did these units fail?</p>
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

      {showSummary && topReasons.length > 0 && (
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
