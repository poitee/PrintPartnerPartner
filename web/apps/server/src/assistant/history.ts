import { randomUUID } from "node:crypto";
import type {
  AssistantFeedbackRating,
  AssistantHistoryMessage,
  AssistantProposedAction,
} from "@print-partner/contracts";
import { isAssistantUiAction } from "@print-partner/contracts";
import { sanitizeAssistantDisplayText } from "./sanitize-display-text.js";
import type { AppRepository } from "../db/repository.js";

const HISTORY_KEY = "assistant_chat_history";
const FEEDBACK_KEY = "assistant_feedback";
const MAX_HISTORY = 40;
const MAX_FEEDBACK = 200;
/** Cap pending Apply cards stored with a single assistant turn. */
const MAX_PENDING_ACTIONS = 12;

function isProposedAction(value: unknown): value is AssistantProposedAction {
  if (!value || typeof value !== "object") return false;
  const a = value as AssistantProposedAction;
  return (
    typeof a.id === "string" &&
    typeof a.type === "string" &&
    typeof a.plan_id === "number" &&
    typeof a.label === "string" &&
    typeof a.summary === "string" &&
    a.params != null &&
    typeof a.params === "object"
  );
}

function sanitizeProposedActions(
  raw: unknown,
): AssistantProposedAction[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const actions = raw
    .filter(isProposedAction)
    .filter((a) => !isAssistantUiAction(a.type))
    .slice(0, MAX_PENDING_ACTIONS);
  return actions.length > 0 ? actions : undefined;
}

function parseHistoryMessage(m: unknown): AssistantHistoryMessage | null {
  if (!m || typeof m !== "object") return null;
  const row = m as AssistantHistoryMessage;
  if (
    typeof row.id !== "string" ||
    typeof row.content !== "string" ||
    (row.role !== "user" && row.role !== "assistant")
  ) {
    return null;
  }
  const proposed = sanitizeProposedActions(row.proposed_actions);
  return {
    id: row.id,
    role: row.role,
    content: sanitizeAssistantDisplayText(row.content),
    created_at: typeof row.created_at === "string" ? row.created_at : new Date().toISOString(),
    ...(proposed ? { proposed_actions: proposed } : {}),
  };
}

export function loadAssistantHistory(repo: AppRepository): AssistantHistoryMessage[] {
  const raw = repo.getSetting(HISTORY_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map(parseHistoryMessage)
      .filter((m): m is AssistantHistoryMessage => m != null)
      .slice(-MAX_HISTORY);
  } catch {
    return [];
  }
}

function persistHistory(repo: AppRepository, messages: AssistantHistoryMessage[]): void {
  repo.setSetting(HISTORY_KEY, JSON.stringify(messages.slice(-MAX_HISTORY)));
}

export function appendAssistantHistory(
  repo: AppRepository,
  entries: Array<{
    role: "user" | "assistant";
    content: string;
    proposed_actions?: AssistantProposedAction[];
  }>,
): AssistantHistoryMessage[] {
  const existing = loadAssistantHistory(repo);
  const now = new Date().toISOString();
  for (const e of entries) {
    if (!e.content.trim() && !(e.proposed_actions && e.proposed_actions.length > 0)) continue;
    const proposed =
      e.role === "assistant" ? sanitizeProposedActions(e.proposed_actions) : undefined;
    existing.push({
      id: randomUUID(),
      role: e.role,
      content: sanitizeAssistantDisplayText(e.content).slice(0, 8000),
      created_at: now,
      ...(proposed ? { proposed_actions: proposed } : {}),
    });
  }
  const trimmed = existing.slice(-MAX_HISTORY);
  persistHistory(repo, trimmed);
  return trimmed;
}

/**
 * Remove a pending proposed action from history after Apply or Dismiss.
 * Returns true when an action was removed.
 */
export function removePendingProposedAction(
  repo: AppRepository,
  actionId: string,
): boolean {
  if (!actionId) return false;
  const messages = loadAssistantHistory(repo);
  let changed = false;
  for (const m of messages) {
    if (!m.proposed_actions?.length) continue;
    const next = m.proposed_actions.filter((a) => a.id !== actionId);
    if (next.length !== m.proposed_actions.length) {
      changed = true;
      m.proposed_actions = next.length > 0 ? next : undefined;
    }
  }
  if (changed) persistHistory(repo, messages);
  return changed;
}

/**
 * Attach additional pending Apply cards to the most recent assistant history turn
 * (e.g. post-Apply Sync → Update build workflow).
 */
export function appendPendingProposedActions(
  repo: AppRepository,
  actions: AssistantProposedAction[],
): boolean {
  const clean = sanitizeProposedActions(actions);
  if (!clean?.length) return false;
  const messages = loadAssistantHistory(repo);
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]!;
    if (m.role !== "assistant") continue;
    const existing = m.proposed_actions ?? [];
    const ids = new Set(existing.map((a) => a.id));
    const merged = [...existing, ...clean.filter((a) => !ids.has(a.id))].slice(
      0,
      MAX_PENDING_ACTIONS,
    );
    m.proposed_actions = merged.length > 0 ? merged : undefined;
    persistHistory(repo, messages);
    return true;
  }
  // No assistant turn yet — store a lightweight stub so reopen still shows the card.
  messages.push({
    id: randomUUID(),
    role: "assistant",
    content: "",
    created_at: new Date().toISOString(),
    proposed_actions: clean,
  });
  persistHistory(repo, messages);
  return true;
}

export function clearAssistantHistory(repo: AppRepository): void {
  repo.setSetting(HISTORY_KEY, JSON.stringify([]));
}

export type StoredFeedback = {
  id: string;
  rating: AssistantFeedbackRating;
  message_excerpt: string | null;
  plan_id: number | null;
  comment: string | null;
  created_at: string;
};

export function loadAssistantFeedback(repo: AppRepository): StoredFeedback[] {
  const raw = repo.getSetting(FEEDBACK_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return (parsed as StoredFeedback[]).slice(-MAX_FEEDBACK);
  } catch {
    return [];
  }
}

export function appendAssistantFeedback(
  repo: AppRepository,
  input: {
    rating: AssistantFeedbackRating;
    message_excerpt?: string;
    plan_id?: number;
    comment?: string;
  },
): StoredFeedback {
  const entry: StoredFeedback = {
    id: randomUUID(),
    rating: input.rating,
    message_excerpt: input.message_excerpt?.slice(0, 500) ?? null,
    plan_id: input.plan_id ?? null,
    comment: input.comment?.slice(0, 1000) ?? null,
    created_at: new Date().toISOString(),
  };
  const list = loadAssistantFeedback(repo);
  list.push(entry);
  repo.setSetting(FEEDBACK_KEY, JSON.stringify(list.slice(-MAX_FEEDBACK)));
  return entry;
}

/** Tiny ranking scores from thumbs — never dump raw feedback into the prompt. */
export type FeedbackScores = {
  /** plan_id → net score (up=+1, down=-1) */
  byPlanId: Map<number, number>;
  /** stack preset id / source-like token → net score (from excerpts) */
  byToken: Map<string, number>;
};

const TOKEN_RE = /\b([a-z][a-z0-9_]{2,}(?:\.[a-z0-9_]+)?)\b/gi;

/**
 * Aggregate assistant_feedback into small ranking scores for recipes / stacks.
 */
export function aggregateFeedbackScores(
  repo: AppRepository,
  knownTokens: Iterable<string> = [],
): FeedbackScores {
  const known = new Set(
    [...knownTokens].map((t) => t.toLowerCase()).filter((t) => t.length >= 3),
  );
  const byPlanId = new Map<number, number>();
  const byToken = new Map<string, number>();
  const bump = <K,>(map: Map<K, number>, key: K, delta: number) => {
    map.set(key, (map.get(key) ?? 0) + delta);
  };

  for (const entry of loadAssistantFeedback(repo)) {
    const delta = entry.rating === "up" ? 1 : entry.rating === "down" ? -1 : 0;
    if (!delta) continue;
    if (entry.plan_id != null) bump(byPlanId, entry.plan_id, delta);
    const hay = `${entry.message_excerpt ?? ""} ${entry.comment ?? ""}`;
    if (!hay.trim() || !known.size) continue;
    const seen = new Set<string>();
    for (const m of hay.matchAll(TOKEN_RE)) {
      const tok = (m[1] ?? "").toLowerCase();
      if (!known.has(tok) || seen.has(tok)) continue;
      seen.add(tok);
      bump(byToken, tok, delta);
    }
  }
  return { byPlanId, byToken };
}

export function scorePlanFeedback(repo: AppRepository, planId: number): number {
  return aggregateFeedbackScores(repo).byPlanId.get(planId) ?? 0;
}

export function scoreStackPreset(
  repo: AppRepository,
  presetId: string,
  knownPresetIds?: Iterable<string>,
): number {
  const known = knownPresetIds ?? [presetId];
  return aggregateFeedbackScores(repo, known).byToken.get(presetId.toLowerCase()) ?? 0;
}
