import type {
  PrintOutcomeEvent,
  PrintRejectReason,
  PrintVerifyDecision,
  PrinterCheckoffLink,
} from "@print-partner/contracts";
import type { AppRepository } from "../db/repository.js";
import {
  applyCheckoffUnits,
  confirmsRespectProgressPrefix,
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

function parseDecisions(
  raw: unknown,
): PrintVerifyDecision[] | { error: string } {
  if (!Array.isArray(raw) || raw.length === 0) {
    return { error: "decisions required (reject needs a reason)" };
  }
  const out: PrintVerifyDecision[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < raw.length; i += 1) {
    const item = raw[i];
    if (!item || typeof item !== "object") {
      return { error: `decisions[${i}] is invalid` };
    }
    const row = item as Record<string, unknown>;
    const partId = Number(row.part_id);
    const unitIndex = Number(row.unit_index);
    const result = row.result;
    if (!Number.isInteger(partId) || partId <= 0) {
      return { error: `decisions[${i}].part_id is invalid` };
    }
    if (!Number.isInteger(unitIndex) || unitIndex < 0) {
      return { error: `decisions[${i}].unit_index is invalid` };
    }
    if (result !== "confirmed" && result !== "rejected") {
      return { error: `decisions[${i}].result must be confirmed or rejected` };
    }
    const key = unitKey(partId, unitIndex);
    if (seen.has(key)) {
      return { error: `decisions[${i}] duplicates another unit` };
    }
    seen.add(key);
    const decision: PrintVerifyDecision = {
      part_id: partId,
      unit_index: unitIndex,
      result,
    };
    if (result === "rejected") {
      if (!isPrintRejectReason(row.reason)) {
        return { error: `decisions[${i}] reject needs a valid reason` };
      }
      decision.reason = row.reason as PrintRejectReason;
    } else if (row.reason != null && row.reason !== "") {
      if (!isPrintRejectReason(row.reason)) {
        return { error: `decisions[${i}].reason is invalid` };
      }
      decision.reason = row.reason;
    }
    if (row.note != null && row.note !== "") {
      if (typeof row.note !== "string") {
        return { error: `decisions[${i}].note is invalid` };
      }
      decision.note = row.note.trim().slice(0, 500) || undefined;
    }
    out.push(decision);
  }
  return out;
}

/**
 * Apply user verify/reject decisions for an awaiting_verify link.
 * Confirms mark Progress units; rejects leave units unprinted and log reasons.
 * Claims the link (resolved_units) before Progress mutation to reduce races.
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

  const parsed = parseDecisions(rawDecisions);
  if ("error" in parsed) {
    return { error: parsed.error, status: 400 };
  }
  const decisions = parsed;

  const pending = new Set(
    pendingCheckoffUnits(link).map((u) => unitKey(u.part_id, u.unit_index)),
  );
  for (const d of decisions) {
    if (!pending.has(unitKey(d.part_id, d.unit_index))) {
      return { error: "All decisions must target pending units on this link", status: 400 };
    }
  }

  const toConfirm = decisions.filter((d) => d.result === "confirmed");
  const toReject = decisions.filter((d) => d.result === "rejected");

  if (toConfirm.length) {
    const partRows = repo.getProfilePartRows(link.profile_id);
    for (const part of partRows) {
      repo.ensureProgressForPart(part);
    }
    const unitsById = repo.printUnitsByPartId(link.profile_id);
    const byPart = new Map<number, number[]>();
    for (const d of toConfirm) {
      const list = byPart.get(d.part_id) ?? [];
      list.push(d.unit_index);
      byPart.set(d.part_id, list);
    }
    for (const [partId, indices] of byPart) {
      const part = partRows.find((p) => p.id === partId);
      if (!part) {
        return { error: `Part ${partId} not found on plan`, status: 400 };
      }
      const qty = Math.max(1, part.quantityEffective);
      const flags = unitsById.get(partId) ?? Array.from({ length: qty }, () => false);
      if (!confirmsRespectProgressPrefix(flags, indices)) {
        return {
          error:
            "Confirm must include lower incomplete units first (Progress fills from the left)",
          status: 400,
        };
      }
    }
  }

  const resolved = mergeResolvedUnits(link.resolved_units, decisions);
  const nextPending = link.units.filter(
    (u) => !resolved.some((r) => r.part_id === u.part_id && r.unit_index === u.unit_index),
  );
  const fullyDone = nextPending.length === 0;

  // Claim before Progress mutation so concurrent verifies cannot double-apply.
  const claimed = updatePrinterCheckoffLink(
    repo,
    link.id,
    {
      resolved_units: resolved,
      state: fullyDone ? "verified" : "awaiting_verify",
      applied_at: fullyDone ? new Date().toISOString() : link.applied_at,
    },
    { requireState: "awaiting_verify" },
  );
  if (!claimed) {
    return { error: "Link changed concurrently", status: 409 };
  }

  let unitsConfirmed = 0;
  if (toConfirm.length) {
    unitsConfirmed = applyCheckoffUnits(
      repo,
      link.profile_id,
      toConfirm.map((d) => ({ part_id: d.part_id, unit_index: d.unit_index })),
    );
    if (unitsConfirmed > 0) {
      updatePrinterCheckoffLink(repo, link.id, {
        units_marked: (link.units_marked ?? 0) + unitsConfirmed,
      });
    }
  }

  const partRows = repo.getProfilePartRows(link.profile_id);
  const byId = new Map(partRows.map((p) => [p.id, p]));
  const outcomes = appendPrintOutcomes(
    repo,
    decisions.map((d) => {
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
    }),
  );

  const updated = getPrinterCheckoffLink(repo, link.id) ?? claimed;
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
