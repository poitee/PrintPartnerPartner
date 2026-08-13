import { basename } from "node:path";
import type {
  PrinterCheckoffLink,
  PrinterCheckoffReconcileUpdate,
  PrinterCheckoffUnit,
  PrinterHostStatus,
  PrintVerifyDecision,
} from "@print-partner/contracts";
import type { AppRepository } from "../db/repository.js";
import {
  listWatchingPrinterCheckoffLinks,
  updatePrinterCheckoffLink,
} from "./printer-checkoff-store.js";

/** Normalize host filenames for matching (paths, case). */
export function normalizePrinterFilename(name: string | undefined | null): string {
  if (!name?.trim()) return "";
  return basename(name.trim().replace(/\\/g, "/")).toLowerCase();
}

export function printerFilenamesMatch(
  a: string | undefined | null,
  b: string | undefined | null,
): boolean {
  const left = normalizePrinterFilename(a);
  const right = normalizePrinterFilename(b);
  if (!left || !right) return false;
  return left === right;
}

export function parseCheckoffUnits(raw: unknown): PrinterCheckoffUnit[] {
  if (typeof raw === "string") {
    try {
      return parseCheckoffUnits(JSON.parse(raw) as unknown);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(raw)) return [];
  const out: PrinterCheckoffUnit[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const partId = Number(row.part_id);
    const unitIndex = Number(row.unit_index);
    if (!Number.isInteger(partId) || partId <= 0) continue;
    if (!Number.isInteger(unitIndex) || unitIndex < 0) continue;
    const key = `${partId}:${unitIndex}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ part_id: partId, unit_index: unitIndex });
  }
  return out;
}

export function unitKey(partId: number, unitIndex: number): string {
  return `${partId}:${unitIndex}`;
}

export function resolvedUnitKeys(link: PrinterCheckoffLink): Set<string> {
  const keys = new Set<string>();
  for (const u of link.resolved_units ?? []) {
    keys.add(unitKey(u.part_id, u.unit_index));
  }
  return keys;
}

export function pendingCheckoffUnits(link: PrinterCheckoffLink): PrinterCheckoffUnit[] {
  const done = resolvedUnitKeys(link);
  return link.units.filter((u) => !done.has(unitKey(u.part_id, u.unit_index)));
}

export type CheckoffReconcileDecision =
  | { action: "noop" }
  | { action: "mark_active"; progress?: number }
  | { action: "await_verify" }
  | { action: "host_failed"; reason: "cancelled" | "error" };

/**
 * Decide how a watching link should advance given the latest host status.
 * Idle/cancel/error never await-verify unless we saw ~100% then missed a brief `complete`.
 */
export function decideCheckoffReconcile(
  link: PrinterCheckoffLink,
  status: PrinterHostStatus,
): CheckoffReconcileDecision {
  if (link.state !== "watching") return { action: "noop" };

  const filenameMatches =
    printerFilenamesMatch(status.filename, link.filename) ||
    printerFilenamesMatch(status.filename, link.remote_path);

  if (status.state === "printing" || status.state === "paused") {
    if (!filenameMatches) return { action: "noop" };
    const progress =
      typeof status.progress === "number" && Number.isFinite(status.progress)
        ? status.progress
        : undefined;
    return { action: "mark_active", progress };
  }

  if (status.state === "complete") {
    if (filenameMatches) return { action: "await_verify" };
    // Host cleared filename after finish — only then trust saw_active / upload&start.
    const hostFilenameEmpty = !normalizePrinterFilename(status.filename);
    if (hostFilenameEmpty && (link.saw_active || link.started)) {
      return { action: "await_verify" };
    }
    return { action: "noop" };
  }

  if (status.state === "error") {
    if (link.saw_active || filenameMatches) return { action: "host_failed", reason: "error" };
    return { action: "noop" };
  }

  if (status.state === "idle") {
    if (!link.saw_active) return { action: "noop" };
    // Missed a brief complete/FINISHED: treat near-done as success.
    if (link.last_progress != null && link.last_progress >= 99) {
      return { action: "await_verify" };
    }
    return { action: "host_failed", reason: "cancelled" };
  }

  return { action: "noop" };
}

/**
 * Apply incomplete mapped units for selected parts (used by verify confirm).
 * Uses Progress prefix-count semantics (patch through highest still-incomplete
 * mapped index). Mapping from Export is always “all incomplete units per
 * selected part,” so this matches manual −/+ fill-from-left behavior.
 */
export function applyCheckoffUnits(
  repo: AppRepository,
  profileId: number,
  units: PrinterCheckoffUnit[],
): number {
  const partRows = repo.getProfilePartRows(profileId);
  const byId = new Map(partRows.map((p) => [p.id, p]));
  for (const part of partRows) {
    repo.ensureProgressForPart(part);
  }
  const unitsById = repo.printUnitsByPartId(profileId);

  const byPart = new Map<number, number[]>();
  for (const u of units) {
    const list = byPart.get(u.part_id) ?? [];
    list.push(u.unit_index);
    byPart.set(u.part_id, list);
  }

  let marked = 0;
  for (const [partId, indices] of byPart) {
    const part = byId.get(partId);
    if (!part) continue;
    const qty = Math.max(1, part.quantityEffective);
    const flags = unitsById.get(partId) ?? Array.from({ length: qty }, () => false);
    const candidates = indices.filter((i) => i >= 0 && i < qty && !flags[i]);
    if (!candidates.length) continue;
    const maxIndex = Math.max(...candidates);
    const before = flags.filter(Boolean).length;
    try {
      const after = repo.patchPartProgress(partId, maxIndex, true);
      marked += Math.max(0, after.printed_count - before);
    } catch {
      /* skip bad part */
    }
  }
  return marked;
}

/**
 * Reconcile watching links for one host against a status snapshot.
 * Idempotent: non-watching links are never re-processed.
 * Host success → awaiting_verify (no Progress mutation).
 */
export function reconcilePrinterCheckoff(
  repo: AppRepository,
  integrationId: string,
  status: PrinterHostStatus,
): PrinterCheckoffReconcileUpdate[] {
  const watching = listWatchingPrinterCheckoffLinks(repo, integrationId);
  const updates: PrinterCheckoffReconcileUpdate[] = [];
  const STALE_MS = 48 * 60 * 60 * 1000;

  for (const link of watching) {
    const createdMs = Date.parse(link.created_at);
    const stale =
      Number.isFinite(createdMs) && Date.now() - createdMs > STALE_MS && !link.saw_active;
    if (
      stale &&
      (status.state === "idle" || status.state === "offline" || status.state === "unknown")
    ) {
      updatePrinterCheckoffLink(repo, link.id, {
        state: "dismissed",
        host_outcome: "unknown",
      });
      continue;
    }

    const decision = decideCheckoffReconcile(link, status);
    if (decision.action === "noop") continue;

    if (decision.action === "mark_active") {
      const patch: {
        saw_active: boolean;
        last_progress?: number;
      } = { saw_active: true };
      if (decision.progress != null) {
        patch.last_progress = Math.max(link.last_progress ?? 0, decision.progress);
      }
      updatePrinterCheckoffLink(repo, link.id, patch);
      continue;
    }

    if (decision.action === "host_failed") {
      const claimed = updatePrinterCheckoffLink(
        repo,
        link.id,
        {
          state: "host_failed",
          host_outcome: decision.reason === "error" ? "failed" : "cancelled",
        },
        { requireState: "watching" },
      );
      if (!claimed) continue;
      updates.push({
        link_id: link.id,
        host_name: link.host_name,
        profile_id: link.profile_id,
        filename: link.filename,
        event: "host_failed",
        host_outcome: claimed.host_outcome ?? "failed",
        units_pending: pendingCheckoffUnits(link).length,
      });
      continue;
    }

    // Claim before notifying so concurrent reconciles cannot double-fire.
    const completedAt = new Date().toISOString();
    const claimed = updatePrinterCheckoffLink(
      repo,
      link.id,
      {
        state: "awaiting_verify",
        host_outcome: "success",
        completed_at: completedAt,
        saw_active: true,
      },
      { requireState: "watching" },
    );
    if (!claimed) continue;

    updates.push({
      link_id: link.id,
      host_name: link.host_name,
      profile_id: link.profile_id,
      filename: link.filename,
      event: "awaiting_verify",
      host_outcome: "success",
      units_pending: pendingCheckoffUnits(claimed).length,
    });
  }

  return updates;
}

export function mergeResolvedUnits(
  existing: PrintVerifyDecision[] | undefined,
  next: PrintVerifyDecision[],
): PrintVerifyDecision[] {
  const map = new Map<string, PrintVerifyDecision>();
  for (const d of existing ?? []) {
    map.set(unitKey(d.part_id, d.unit_index), d);
  }
  for (const d of next) {
    map.set(unitKey(d.part_id, d.unit_index), d);
  }
  return [...map.values()];
}
