import type {
  PrintOutcomeEvent,
  PrintRejectReason,
  PrintVerifyDecision,
  PrinterCheckoffLink,
} from "@print-partner/contracts";
import type { AppRepository } from "../db/repository.js";
import {
  applyCheckoffUnits,
  mergeResolvedUnits,
  pendingCheckoffUnits,
  unitKey,
} from "./printer-checkoff.js";
import {
  getPrinterCheckoffLink,
  updatePrinterCheckoffLink,
} from "./printer-checkoff-store.js";
import {
  appendPrintOutcomes,
  isPrintRejectReason,
} from "./printer-outcomes-store.js";

export type VerifyPrinterCheckoffResult = {
  link: PrinterCheckoffLink;
  units_confirmed: number;
  units_rejected: number;
  outcomes: PrintOutcomeEvent[];
};

function sanitizeDecisions(raw: unknown): PrintVerifyDecision[] {
  if (!Array.isArray(raw)) return [];
  const out: PrintVerifyDecision[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const partId = Number(row.part_id);
    const unitIndex = Number(row.unit_index);
    const result = row.result;
    if (!Number.isInteger(partId) || partId <= 0) continue;
    if (!Number.isInteger(unitIndex) || unitIndex < 0) continue;
    if (result !== "confirmed" && result !== "rejected") continue;
    const key = unitKey(partId, unitIndex);
    if (seen.has(key)) continue;
    seen.add(key);
    const decision: PrintVerifyDecision = {
      part_id: partId,
      unit_index: unitIndex,
      result,
    };
    if (result === "rejected") {
      if (!isPrintRejectReason(row.reason)) {
        continue; // reject requires a valid reason
      }
      decision.reason = row.reason as PrintRejectReason;
    } else if (isPrintRejectReason(row.reason)) {
      decision.reason = row.reason;
    }
    if (typeof row.note === "string" && row.note.trim()) {
      decision.note = row.note.trim().slice(0, 500);
    }
    out.push(decision);
  }
  return out;
}

/**
 * Apply user verify/reject decisions for an awaiting_verify link.
 * Confirms mark Progress units; rejects leave units unprinted and log reasons.
 */
export function verifyPrinterCheckoff(
  repo: AppRepository,
  linkId: string,
  rawDecisions: unknown,
): VerifyPrinterCheckoffResult | { error: string; status: number } {
  const link = getPrinterCheckoffLink(repo, linkId);
  if (!link) return { error: "Checkoff link not found", status: 404 };
  if (link.state !== "awaiting_verify") {
    return { error: "Link is not awaiting verify", status: 409 };
  }

  const decisions = sanitizeDecisions(rawDecisions);
  if (!decisions.length) {
    return { error: "decisions required (reject needs a reason)", status: 400 };
  }

  const pending = new Set(
    pendingCheckoffUnits(link).map((u) => unitKey(u.part_id, u.unit_index)),
  );
  const allowed = decisions.filter((d) => pending.has(unitKey(d.part_id, d.unit_index)));
  if (!allowed.length) {
    return { error: "No pending units matched decisions", status: 400 };
  }

  const toConfirm = allowed.filter((d) => d.result === "confirmed");
  const toReject = allowed.filter((d) => d.result === "rejected");

  let unitsConfirmed = 0;
  if (toConfirm.length) {
    unitsConfirmed = applyCheckoffUnits(
      repo,
      link.profile_id,
      toConfirm.map((d) => ({ part_id: d.part_id, unit_index: d.unit_index })),
    );
  }

  const partRows = repo.getProfilePartRows(link.profile_id);
  const byId = new Map(partRows.map((p) => [p.id, p]));

  const outcomeInputs = allowed.map((d) => {
    const part = byId.get(d.part_id);
    return {
      profile_id: link.profile_id,
      part_id: d.part_id,
      unit_index: d.unit_index,
      result: d.result,
      reason: d.reason,
      note: d.note,
      host_integration_id: link.integration_id,
      filename: link.filename,
      match_key: part?.matchKey || undefined,
      role: part?.role || undefined,
      filament_display: undefined,
      link_id: link.id,
    };
  });

  const outcomes = appendPrintOutcomes(repo, outcomeInputs);

  const resolved = mergeResolvedUnits(link.resolved_units, allowed);
  const nextPending = link.units.filter(
    (u) => !resolved.some((r) => r.part_id === u.part_id && r.unit_index === u.unit_index),
  );
  const fullyDone = nextPending.length === 0;

  const updated = updatePrinterCheckoffLink(
    repo,
    link.id,
    {
      resolved_units: resolved,
      state: fullyDone ? "verified" : "awaiting_verify",
      units_marked: (link.units_marked ?? 0) + unitsConfirmed,
      applied_at: fullyDone ? new Date().toISOString() : link.applied_at,
    },
    { requireState: "awaiting_verify" },
  );

  if (!updated) {
    return { error: "Link changed concurrently", status: 409 };
  }

  return {
    link: updated,
    units_confirmed: unitsConfirmed,
    units_rejected: toReject.length,
    outcomes,
  };
}

export function dismissHostFailedLink(
  repo: AppRepository,
  linkId: string,
): PrinterCheckoffLink | { error: string; status: number } {
  const link = getPrinterCheckoffLink(repo, linkId);
  if (!link) return { error: "Checkoff link not found", status: 404 };
  if (link.state !== "host_failed") {
    return { error: "Link is not host_failed", status: 409 };
  }
  const updated = updatePrinterCheckoffLink(
    repo,
    linkId,
    { state: "dismissed" },
    { requireState: "host_failed" },
  );
  if (!updated) return { error: "Link changed concurrently", status: 409 };
  return updated;
}
