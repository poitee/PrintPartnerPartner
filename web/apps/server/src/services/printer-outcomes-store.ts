import { randomUUID } from "node:crypto";
import type {
  PrintOutcomeEvent,
  PrintOutcomesSummary,
  PrintRejectReason,
} from "@print-partner/contracts";
import type { AppRepository } from "../db/repository.js";

const SETTINGS_KEY = "printer.print_outcomes";
const MAX_EVENTS = 2000;

const REASONS = new Set<PrintRejectReason>([
  "bed_adhesion",
  "layer_shift",
  "warping",
  "stringing",
  "under_extrusion",
  "over_extrusion",
  "dimensional",
  "collision",
  "wrong_filament",
  "other",
]);

export function isPrintRejectReason(value: unknown): value is PrintRejectReason {
  return typeof value === "string" && REASONS.has(value as PrintRejectReason);
}

function parseEvent(raw: unknown): PrintOutcomeEvent | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  const id = typeof row.id === "string" ? row.id.trim() : "";
  const result = row.result;
  if (result !== "confirmed" && result !== "rejected") return null;
  const profileId = Number(row.profile_id);
  const partId = Number(row.part_id);
  const unitIndex = Number(row.unit_index);
  if (!id || !Number.isInteger(profileId) || profileId <= 0) return null;
  if (!Number.isInteger(partId) || partId <= 0) return null;
  if (!Number.isInteger(unitIndex) || unitIndex < 0) return null;
  const event: PrintOutcomeEvent = {
    id,
    at: typeof row.at === "string" && row.at ? row.at : new Date().toISOString(),
    profile_id: profileId,
    part_id: partId,
    unit_index: unitIndex,
    result,
  };
  if (isPrintRejectReason(row.reason)) event.reason = row.reason;
  if (typeof row.note === "string" && row.note.trim()) {
    event.note = row.note.trim().slice(0, 500);
  }
  if (typeof row.host_integration_id === "string" && row.host_integration_id.trim()) {
    event.host_integration_id = row.host_integration_id.trim();
  }
  if (typeof row.filename === "string" && row.filename.trim()) {
    event.filename = row.filename.trim();
  }
  if (typeof row.match_key === "string" && row.match_key.trim()) {
    event.match_key = row.match_key.trim();
  }
  if (typeof row.role === "string" && row.role.trim()) {
    event.role = row.role.trim();
  }
  if (typeof row.filament_display === "string" && row.filament_display.trim()) {
    event.filament_display = row.filament_display.trim();
  }
  if (typeof row.link_id === "string" && row.link_id.trim()) {
    event.link_id = row.link_id.trim();
  }
  return event;
}

export function loadPrintOutcomes(repo: AppRepository): PrintOutcomeEvent[] {
  const raw = repo.getSetting(SETTINGS_KEY);
  if (!raw?.trim()) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.map(parseEvent).filter((x): x is PrintOutcomeEvent => x != null);
  } catch {
    return [];
  }
}

function savePrintOutcomes(repo: AppRepository, events: PrintOutcomeEvent[]): void {
  repo.setSetting(SETTINGS_KEY, JSON.stringify(events.slice(-MAX_EVENTS)));
}

export function appendPrintOutcomes(
  repo: AppRepository,
  events: Omit<PrintOutcomeEvent, "id" | "at">[],
): PrintOutcomeEvent[] {
  if (!events.length) return [];
  const all = loadPrintOutcomes(repo);
  const created: PrintOutcomeEvent[] = events.map((e) => ({
    ...e,
    id: randomUUID(),
    at: new Date().toISOString(),
  }));
  all.push(...created);
  savePrintOutcomes(repo, all);
  return created;
}

export function summarizePrintOutcomes(
  repo: AppRepository,
  profileId: number,
): PrintOutcomesSummary {
  const events = loadPrintOutcomes(repo).filter((e) => e.profile_id === profileId);
  const by_reason: Partial<Record<PrintRejectReason, number>> = {};
  const by_role: Record<string, { confirmed: number; rejected: number }> = {};
  let total_confirmed = 0;
  let total_rejected = 0;

  for (const e of events) {
    if (e.result === "confirmed") total_confirmed += 1;
    else total_rejected += 1;

    if (e.result === "rejected" && e.reason) {
      by_reason[e.reason] = (by_reason[e.reason] ?? 0) + 1;
    }

    const role = e.role?.trim() || "(none)";
    const bucket = by_role[role] ?? { confirmed: 0, rejected: 0 };
    if (e.result === "confirmed") bucket.confirmed += 1;
    else bucket.rejected += 1;
    by_role[role] = bucket;
  }

  const recent_rejected = events
    .filter((e) => e.result === "rejected")
    .slice(-10)
    .reverse();

  return {
    profile_id: profileId,
    total_confirmed,
    total_rejected,
    by_reason,
    by_role,
    recent_rejected,
  };
}
