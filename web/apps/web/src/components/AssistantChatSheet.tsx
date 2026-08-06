import { useEffect, useRef, useState, type FormEvent } from "react";
import { toast } from "sonner";
import type { AssistantChatMessage, AssistantProposedAction } from "@print-partner/contracts";
import { isAssistantUiAction } from "@print-partner/contracts";
import {
  applyAssistantAction,
  clearAssistantDecisions,
  clearAssistantFeedback,
  clearAssistantHistory,
  createSourceNote,
  dismissAssistantAction,
  fetchAssistantFeedback,
  fetchAssistantHistory,
  fetchAssistantStatus,
  fetchProfileLayers,
  postAssistantFeedback,
  streamAssistantChat,
} from "../api/engine";
import {
  BookmarkPlus,
  Eraser,
  Loader2,
  SendHorizontal,
  Sparkles,
  ThumbsDown,
  ThumbsUp,
  X,
} from "lucide-react";
import { useProfileSelection } from "../context/ProfileContext";
import { useCopilotUiOptional } from "../context/CopilotUiContext";
import { usePlanRevisionBump } from "../context/PlanWorkspaceContext";
import { Button } from "./ui/button";
import { ScrollArea } from "./ui/scroll-area";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "./ui/sheet";
import { cn } from "../lib/utils";
import { sanitizeAssistantDisplayText } from "../lib/sanitizeAssistantDisplayText";

type ChatTurn = {
  id: string;
  role: "user" | "assistant";
  content: string;
  actions?: AssistantProposedAction[];
  feedback?: "up" | "down" | null;
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

let turnSeq = 0;
function nextId(): string {
  turnSeq += 1;
  return `t${turnSeq}`;
}

/** Match server feedbackExcerptKey — restore thumbs after reload. */
function feedbackExcerptKey(excerpt: string): string {
  const s = excerpt.trim().slice(0, 400);
  let h = 0;
  for (let i = 0; i < s.length; i += 1) {
    h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  }
  return `ex${h}`;
}

/** Readable key → value rows for Apply card params (kit selections expand). */
function actionParamRows(action: AssistantProposedAction): Array<{ key: string; value: string }> {
  const params = action.params;
  if (!params) return [];

  if (action.type === "update_kit_selections") {
    const selections = params.selections;
    if (selections && typeof selections === "object" && !Array.isArray(selections)) {
      return Object.entries(selections as Record<string, unknown>)
        .filter(([, v]) => v != null && v !== "")
        .map(([k, v]) => ({ key: k, value: String(v) }));
    }
  }

  const rows: Array<{ key: string; value: string }> = [];
  for (const [k, v] of Object.entries(params)) {
    if (k === "suggested_excludes" || v == null || v === "") continue;
    if (v && typeof v === "object" && !Array.isArray(v)) {
      const entries = Object.entries(v as Record<string, unknown>).filter(
        ([, ev]) => ev != null && ev !== "",
      );
      if (
        entries.length > 0 &&
        entries.length <= 6 &&
        entries.every(([, ev]) => typeof ev === "string" || typeof ev === "number" || typeof ev === "boolean")
      ) {
        for (const [sk, sv] of entries) {
          rows.push({ key: `${k}.${sk}`, value: String(sv) });
        }
        continue;
      }
      rows.push({ key: k, value: JSON.stringify(v) });
      continue;
    }
    rows.push({ key: k, value: Array.isArray(v) ? v.map(String).join(", ") : String(v) });
  }
  return rows;
}

export default function AssistantChatSheet({ open, onOpenChange }: Props) {
  const { selectedProfileId, reloadProfiles } = useProfileSelection();
  const copilot = useCopilotUiOptional();
  const bumpPlanRevision = usePlanRevisionBump();
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [model, setModel] = useState<string | null>(null);
  const [useOtherBuilds, setUseOtherBuilds] = useState(true);
  const [applyingId, setApplyingId] = useState<string | null>(null);
  const [applyingHint, setApplyingHint] = useState<string | null>(null);
  /** Per-action edits to suggested_excludes before confirm-to-apply. */
  const [excludeEdits, setExcludeEdits] = useState<Record<string, string[]>>({});
  const [toolsNote, setToolsNote] = useState<string | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [clearingHistory, setClearingHistory] = useState(false);
  const [clearingMemory, setClearingMemory] = useState(false);
  const [budgetHint, setBudgetHint] = useState<string | null>(null);
  const [savingNoteId, setSavingNoteId] = useState<string | null>(null);
  const [noteSavedId, setNoteSavedId] = useState<string | null>(null);
  const [showEarlier, setShowEarlier] = useState(false);
  const [feedbackCommentTurnId, setFeedbackCommentTurnId] = useState<string | null>(null);
  const [feedbackCommentDraft, setFeedbackCommentDraft] = useState("");
  const [pendingFeedbackRating, setPendingFeedbackRating] = useState<"up" | "down" | null>(
    null,
  );
  const bottomRef = useRef<HTMLDivElement>(null);
  const followUpCardRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const pendingActionsRef = useRef<AssistantProposedAction[]>([]);
  const busyRef = useRef(false);

  useEffect(() => {
    busyRef.current = busy;
  }, [busy]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setHistoryLoading(true);
    setError(null);
    void Promise.all([
      fetchAssistantStatus(),
      fetchAssistantHistory(),
      fetchAssistantFeedback().catch(() => ({ entries: [] as const })),
    ])
      .then(([status, hist, feedback]) => {
        if (cancelled) return;
        setEnabled(status.enabled);
        setModel(status.model);
        setUseOtherBuilds(status.use_other_builds_as_examples !== false);
        const reqCap = status.daily_request_budget;
        const tokCap = status.daily_token_budget;
        if ((reqCap != null && reqCap > 0) || (tokCap != null && tokCap > 0)) {
          const parts: string[] = [];
          if (reqCap != null && reqCap > 0) {
            parts.push(`requests ${status.daily_requests_used ?? 0}/${reqCap}`);
          }
          if (tokCap != null && tokCap > 0) {
            parts.push(`tokens ~${status.daily_tokens_used ?? 0}/${tokCap}`);
          }
          setBudgetHint(`Today: ${parts.join(", ")}`);
        } else {
          setBudgetHint(null);
        }
        // Reload prior turns unless a stream is in flight.
        if (!busyRef.current) {
          setShowEarlier(false);
          const byKey = new Map<string, "up" | "down">();
          for (const e of feedback.entries) {
            if (e.excerpt_key && (e.rating === "up" || e.rating === "down")) {
              byKey.set(e.excerpt_key, e.rating);
            }
          }
          setTurns(
            hist.messages
              .filter((m) => m.role === "user" || m.role === "assistant")
              .map((m) => {
                const content =
                  m.role === "assistant"
                    ? sanitizeAssistantDisplayText(m.content)
                    : m.content;
                const rating =
                  m.role === "assistant"
                    ? byKey.get(feedbackExcerptKey(content.slice(0, 400)))
                    : undefined;
                return {
                  id: m.id,
                  role: m.role as "user" | "assistant",
                  content,
                  actions:
                    m.role === "assistant" && m.proposed_actions?.length
                      ? m.proposed_actions.filter((a) => !isAssistantUiAction(a.type))
                      : undefined,
                  feedback: rating ?? null,
                };
              }),
          );
        }
      })
      .catch(() => {
        if (!cancelled) setEnabled(false);
      })
      .finally(() => {
        if (!cancelled) setHistoryLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [turns, busy, historyLoading]);

  useEffect(() => {
    if (!open) {
      abortRef.current?.abort();
      abortRef.current = null;
      setBusy(false);
    }
  }, [open]);

  async function onClearHistory() {
    if (busy || clearingHistory) return;
    setClearingHistory(true);
    setError(null);
    try {
      await clearAssistantHistory();
      setTurns([]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setClearingHistory(false);
    }
  }

  async function onClearPlanDecisions() {
    if (busy || clearingMemory || selectedProfileId == null) return;
    const ok = window.confirm(
      "Clear Apply/Dismiss memory for this plan? The advisor will forget prefer/avoid for this plan (chat history and thumbs stay).",
    );
    if (!ok) return;
    setClearingMemory(true);
    setError(null);
    try {
      const res = await clearAssistantDecisions({ planId: selectedProfileId });
      toast.success(
        res.deleted > 0
          ? `Cleared ${res.deleted} decision${res.deleted === 1 ? "" : "s"} for this plan`
          : "No decisions to clear for this plan",
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setClearingMemory(false);
    }
  }

  async function onClearThumbsFeedback() {
    if (busy || clearingMemory) return;
    const ok = window.confirm(
      "Clear all thumbs ratings? Stack ranking from thumbs will reset (chat and Apply/Dismiss memory stay).",
    );
    if (!ok) return;
    setClearingMemory(true);
    setError(null);
    try {
      const res = await clearAssistantFeedback();
      setTurns((prev) => prev.map((t) => ({ ...t, feedback: null })));
      toast.success(
        res.deleted > 0
          ? `Cleared ${res.deleted} thumbs rating${res.deleted === 1 ? "" : "s"}`
          : "No thumbs ratings to clear",
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setClearingMemory(false);
    }
  }

  async function sendMessage(text: string) {
    const content = text.trim();
    if (!content || busy || enabled === false) return;

    const userTurn: ChatTurn = { id: nextId(), role: "user", content };
    const assistantId = nextId();
    pendingActionsRef.current = [];
    setTurns((prev) => [...prev, userTurn, { id: assistantId, role: "assistant", content: "" }]);
    setDraft("");
    setError(null);
    setToolsNote(null);
    setBusy(true);

    const history: AssistantChatMessage[] = [...turns, userTurn].map((t) => ({
      role: t.role,
      content: t.content,
    }));

    const ac = new AbortController();
    abortRef.current = ac;

    await streamAssistantChat(
      {
        messages: history,
        plan_id: selectedProfileId != null && selectedProfileId > 0 ? selectedProfileId : undefined,
        use_other_builds_as_examples: useOtherBuilds,
      },
      {
        onToken(token) {
          setTurns((prev) =>
            prev.map((t) =>
              t.id === assistantId ? { ...t, content: t.content + token } : t,
            ),
          );
        },
        onAction(action) {
          if (isAssistantUiAction(action.type) && copilot) {
            // Toast covers feedback — don't pollute chat history with ↗ lines.
            copilot.executeUiAction(action);
            return;
          }
          pendingActionsRef.current = [...pendingActionsRef.current, action];
          setTurns((prev) =>
            prev.map((t) =>
              t.id === assistantId
                ? { ...t, actions: [...(t.actions ?? []), action] }
                : t,
            ),
          );
        },
        onMeta(meta) {
          if (meta.tools_degraded) {
            setToolsNote(
              meta.note ??
                "This model does not support tool calling; answers use stuffed catalog/plan context.",
            );
          }
        },
        onDone(data) {
          const finalContent = data?.final_content;
          const proposed = data?.proposed_actions ?? [];
          if (finalContent != null || proposed.length > 0) {
            setTurns((prev) =>
              prev.map((t) => {
                if (t.id !== assistantId) return t;
                const existingIds = new Set((t.actions ?? []).map((a) => a.id));
                // UI actions auto-run via onAction — never render Apply cards for them.
                const extras = proposed.filter(
                  (a) => !existingIds.has(a.id) && !isAssistantUiAction(a.type),
                );
                return {
                  ...t,
                  content: finalContent ?? t.content,
                  actions: extras.length
                    ? [...(t.actions ?? []), ...extras]
                    : t.actions,
                };
              }),
            );
          }
          setBusy(false);
        },
        onError(message) {
          setError(message);
          setBusy(false);
          setTurns((prev) =>
            prev.map((t) =>
              t.id === assistantId && !t.content
                ? { ...t, content: "(no response)" }
                : t,
            ),
          );
        },
      },
      ac.signal,
    );

    if (abortRef.current === ac) abortRef.current = null;
    setBusy(false);

    // Refresh budget hint after a turn (best-effort).
    void fetchAssistantStatus()
      .then((status) => {
        const reqCap = status.daily_request_budget;
        const tokCap = status.daily_token_budget;
        if ((reqCap != null && reqCap > 0) || (tokCap != null && tokCap > 0)) {
          const parts: string[] = [];
          if (reqCap != null && reqCap > 0) {
            parts.push(`requests ${status.daily_requests_used ?? 0}/${reqCap}`);
          }
          if (tokCap != null && tokCap > 0) {
            parts.push(`tokens ~${status.daily_tokens_used ?? 0}/${tokCap}`);
          }
          setBudgetHint(`Today: ${parts.join(", ")}`);
        }
      })
      .catch(() => {
        /* ignore */
      });
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    void sendMessage(draft);
  }

  function suggestedExcludesFor(action: AssistantProposedAction): string[] | null {
    const raw = action.params?.suggested_excludes;
    if (!Array.isArray(raw)) return null;
    return raw.map((x) => String(x).trim()).filter(Boolean);
  }

  function resolvedExcludes(action: AssistantProposedAction): string[] {
    if (excludeEdits[action.id] != null) return excludeEdits[action.id]!;
    return suggestedExcludesFor(action) ?? [];
  }

  function toggleExclude(actionId: string, tag: string, selected: boolean, baseline: string[]) {
    setExcludeEdits((prev) => {
      const current = prev[actionId] ?? baseline;
      const next = selected
        ? current.includes(tag)
          ? current
          : [...current, tag]
        : current.filter((t) => t !== tag);
      return { ...prev, [actionId]: next };
    });
  }

  async function onApply(action: AssistantProposedAction, turnId: string) {
    setApplyingId(action.id);
    setError(null);
    const isSyncThenUpdate =
      action.type === "apply_build_recipe" &&
      action.params?.workflow === "sync_then_recompute";
    if (isSyncThenUpdate) {
      setApplyingHint("Syncing sources, then updating build…");
      toast.message("Syncing sources — this can take a minute");
    }
    const baselineExcludes = suggestedExcludesFor(action);
    const actionToApply: AssistantProposedAction =
      baselineExcludes != null
        ? {
            ...action,
            params: {
              ...action.params,
              suggested_excludes: resolvedExcludes(action),
            },
          }
        : action;
    try {
      const result = await applyAssistantAction(actionToApply);
      if (!result.ok) {
        setError(result.detail ?? "Failed to apply action");
        return;
      }
      const resultObj =
        result.result && typeof result.result === "object"
          ? (result.result as Record<string, unknown>)
          : null;
      const needsSync = resultObj?.needs_sync === true;
      const syncSource =
        typeof resultObj?.source_name === "string" ? resultObj.source_name : null;
      const followUpRaw = resultObj?.follow_up_action;
      const followUp =
        followUpRaw &&
        typeof followUpRaw === "object" &&
        typeof (followUpRaw as AssistantProposedAction).type === "string" &&
        typeof (followUpRaw as AssistantProposedAction).id === "string" &&
        !isAssistantUiAction((followUpRaw as AssistantProposedAction).type)
          ? (followUpRaw as AssistantProposedAction)
          : null;

      void reloadProfiles().catch((e) =>
        toast.error(e instanceof Error ? e.message : "Failed to reload plans"),
      );
      void bumpPlanRevision().catch((e) =>
        toast.error(e instanceof Error ? e.message : "Failed to refresh plan"),
      );

      setExcludeEdits((prev) => {
        if (!(action.id in prev)) return prev;
        const next = { ...prev };
        delete next[action.id];
        return next;
      });

      setTurns((prev) =>
        prev.map((t) => {
          if (t.id !== turnId) return t;
          const remaining = (t.actions ?? []).filter((a) => a.id !== action.id);
          const nextActions =
            followUp && !remaining.some((a) => a.id === followUp.id)
              ? [...remaining, followUp]
              : remaining;
          return {
            ...t,
            actions: nextActions.length ? nextActions : undefined,
            content:
              t.content +
              `\n\n✓ Applied: ${action.label}${
                result.job_id ? ` (job ${result.job_id.slice(0, 8)}…)` : ""
              }${
                followUp
                  ? "\n→ Recommended next: Sync & update the build (card below)."
                  : isSyncThenUpdate
                    ? "\n→ Build is updating — opening Build."
                    : needsSync
                      ? "\n→ Sync this source, then Update build."
                      : ""
              }`,
          };
        }),
      );

      if (followUp) {
        requestAnimationFrame(() => {
          followUpCardRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
        });
      }

      if (isSyncThenUpdate && result.ok && copilot) {
        copilot.executeUiAction({
          id: `post-sync-update-${action.id}`,
          type: "ui_navigate",
          plan_id: action.plan_id,
          label: "Open Build",
          summary: "Open Build after Sync → Update",
          params: {
            route: "build",
            plan_id: action.plan_id,
            silent: true,
          },
        });
        toast.success("Synced and Update build queued — opening Build");
      }

      // Prefer the Sync → Update card; only navigate when no follow-up was returned.
      if (needsSync && !followUp && copilot) {
        copilot.executeUiAction({
          id: `post-apply-sync-${action.id}`,
          type: "ui_open_source",
          plan_id: action.plan_id,
          label: "Open source for sync",
          summary: "Open Sources after Apply",
          params: {
            source_name: syncSource ?? undefined,
            tab: "docs",
          },
        });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setApplyingId(null);
      setApplyingHint(null);
    }
  }

  function onDismiss(action: AssistantProposedAction, turnId: string) {
    setExcludeEdits((prev) => {
      if (!(action.id in prev)) return prev;
      const next = { ...prev };
      delete next[action.id];
      return next;
    });
    setTurns((prev) =>
      prev.map((t) =>
        t.id === turnId
          ? { ...t, actions: (t.actions ?? []).filter((a) => a.id !== action.id) }
          : t,
      ),
    );
    void dismissAssistantAction(action).catch(() => {
      /* best-effort */
    });
  }

  async function onFeedback(turn: ChatTurn, rating: "up" | "down", comment?: string) {
    setTurns((prev) =>
      prev.map((t) => (t.id === turn.id ? { ...t, feedback: rating } : t)),
    );
    setFeedbackCommentTurnId(null);
    setFeedbackCommentDraft("");
    setPendingFeedbackRating(null);
    try {
      await postAssistantFeedback({
        rating,
        message_excerpt: turn.content.slice(0, 400),
        plan_id:
          selectedProfileId != null && selectedProfileId > 0 ? selectedProfileId : undefined,
        comment: comment?.trim() ? comment.trim().slice(0, 200) : undefined,
      });
    } catch {
      /* non-blocking */
    }
  }

  function beginFeedback(turn: ChatTurn, rating: "up" | "down") {
    setFeedbackCommentTurnId(turn.id);
    setPendingFeedbackRating(rating);
    setFeedbackCommentDraft("");
  }

  async function onSaveToNotes(turn: ChatTurn) {
    if (!turn.content.trim()) return;
    setSavingNoteId(turn.id);
    setError(null);
    try {
      let sourceId: number | null = null;
      if (selectedProfileId != null && selectedProfileId > 0) {
        const layers = await fetchProfileLayers(selectedProfileId);
        const base = layers.find((l) => l.layer_type === "base" && l.project_id);
        const any = layers.find((l) => l.project_id);
        sourceId = (base?.project_id ?? any?.project_id) ?? null;
      }
      if (sourceId == null) {
        setError("Attach a source to the active plan before saving notes.");
        return;
      }
      await createSourceNote(sourceId, {
        title: "Kit advisor insight",
        body_markdown: turn.content.trim(),
        profile_id:
          selectedProfileId != null && selectedProfileId > 0
            ? selectedProfileId
            : null,
      });
      setNoteSavedId(turn.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save note");
    } finally {
      setSavingNoteId(null);
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange} modal={false}>
      <SheetContent
        showOverlay={false}
        className="max-w-md gap-0 p-0 sm:max-w-md"
        onInteractOutside={(e) => {
          // Keep chat open while navigating / working in the app.
          e.preventDefault();
        }}
        onPointerDownOutside={(e) => {
          e.preventDefault();
        }}
      >
        <SheetHeader className="pr-12">
          <SheetTitle className="flex items-center gap-2 text-base">
            <Sparkles className="h-4 w-4 text-primary" aria-hidden />
            Kit advisor
          </SheetTitle>
          <SheetDescription>
            Stays open while you move between Sources, Build, and Review so you can work together.
            Confirm-before-apply for plan changes. {model ? `Model: ${model}.` : null}
          </SheetDescription>
        </SheetHeader>

        {enabled === false ? (
          <div className="flex flex-1 flex-col gap-3 p-4 text-sm text-muted-foreground">
            <p>
              The AI advisor is disabled. Configure it under{" "}
              <span className="font-medium text-foreground">
                Settings → Optional integrations → AI assistant
              </span>{" "}
              (Ollama recommended for self-host), or set operator env vars (see DEPLOY.md).
            </p>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Close
            </Button>
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2 text-xs text-muted-foreground">
              <label className="flex items-center gap-1.5">
                <input
                  type="checkbox"
                  checked={useOtherBuilds}
                  disabled={busy}
                  onChange={(e) => setUseOtherBuilds(e.target.checked)}
                />
                Use other builds as examples
              </label>
              <div className="ml-auto flex flex-wrap items-center justify-end gap-1">
                {historyLoading && (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-label="Loading history" />
                )}
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="h-7 gap-1 px-2 text-xs"
                  disabled={busy || clearingHistory || turns.length === 0}
                  onClick={() => void onClearHistory()}
                  aria-label="Clear chat history"
                  title="Clear chat history (keeps Apply/Dismiss memory)"
                >
                  {clearingHistory ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Eraser className="h-3.5 w-3.5" />
                  )}
                  Clear chat
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="h-7 gap-1 px-2 text-xs"
                  disabled={busy || clearingMemory || selectedProfileId == null}
                  onClick={() => void onClearPlanDecisions()}
                  aria-label="Clear plan decision memory"
                  title="Clear Apply/Dismiss prefer/avoid for this plan"
                >
                  {clearingMemory ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : null}
                  Clear decisions
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="h-7 gap-1 px-2 text-xs"
                  disabled={busy || clearingMemory}
                  onClick={() => void onClearThumbsFeedback()}
                  aria-label="Clear thumbs ratings"
                  title="Clear thumbs up/down ranking"
                >
                  Clear thumbs
                </Button>
              </div>
            </div>
            {budgetHint && (
              <p className="border-b border-border px-4 py-1.5 text-xs text-muted-foreground">
                {budgetHint}
              </p>
            )}

            <ScrollArea className="min-h-0 flex-1 px-4 py-3">
              <div className="flex flex-col gap-3">
                {turns.length === 0 && !historyLoading && (
                  <div className="space-y-3 text-sm text-muted-foreground">
                    <p>
                      Ask how to attach a Voron base, which stack fits, or what Sync → Update
                      does. Changes show as Apply cards — nothing mutates until you confirm.
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {[
                        "Set up Voron Trident R2 with LDO addons",
                        "Open Voron-Trident docs",
                        "What should I sync after a tag change?",
                      ].map((prompt) => (
                        <Button
                          key={prompt}
                          type="button"
                          size="sm"
                          variant="outline"
                          className="h-auto max-w-full whitespace-normal px-2 py-1.5 text-left text-xs"
                          disabled={busy || enabled !== true}
                          onClick={() => void sendMessage(prompt)}
                        >
                          {prompt}
                        </Button>
                      ))}
                    </div>
                  </div>
                )}
                {toolsNote && (
                  <p className="text-xs text-muted-foreground" role="status">
                    {toolsNote}
                  </p>
                )}
                {(() => {
                  const KEEP = 8;
                  const hidden = !showEarlier && turns.length > KEEP ? turns.length - KEEP : 0;
                  const visible = hidden > 0 ? turns.slice(hidden) : turns;
                  const lastAssistantId = [...turns]
                    .reverse()
                    .find((t) => t.role === "assistant" && t.content)?.id;
                  return (
                    <>
                      {hidden > 0 && (
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          className="mx-auto h-7 text-xs text-muted-foreground"
                          onClick={() => setShowEarlier(true)}
                        >
                          Show {hidden} earlier message{hidden === 1 ? "" : "s"}
                        </Button>
                      )}
                      {visible.map((turn) => (
                  <div key={turn.id} className="flex flex-col gap-2">
                    <div
                      className={cn(
                        "max-w-[95%] rounded-lg px-3 py-2 text-sm leading-relaxed whitespace-pre-wrap",
                        turn.role === "user"
                          ? "ml-auto bg-primary text-primary-foreground"
                          : "mr-auto border border-border bg-muted/40 text-foreground",
                      )}
                    >
                      {turn.content.length > 900
                        ? `${turn.content.slice(0, 900)}…`
                        : turn.content || (busy ? "…" : "")}
                    </div>
                    {turn.role === "assistant" &&
                      turn.content &&
                      !busy &&
                      turn.id === lastAssistantId && (
                      <div className="mr-auto flex items-center gap-0.5 opacity-70 transition-opacity hover:opacity-100">
                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          className="h-6 w-6"
                          aria-label="Helpful"
                          disabled={turn.feedback != null}
                          onClick={() => beginFeedback(turn, "up")}
                        >
                          <ThumbsUp
                            className={cn(
                              "h-3 w-3",
                              turn.feedback === "up" && "text-primary",
                            )}
                          />
                        </Button>
                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          className="h-6 w-6"
                          aria-label="Not helpful"
                          disabled={turn.feedback != null}
                          onClick={() => beginFeedback(turn, "down")}
                        >
                          <ThumbsDown
                            className={cn(
                              "h-3 w-3",
                              turn.feedback === "down" && "text-destructive",
                            )}
                          />
                        </Button>
                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          className="h-6 w-6"
                          aria-label="Save to notes"
                          title="Save to notes"
                          disabled={savingNoteId === turn.id}
                          onClick={() => void onSaveToNotes(turn)}
                        >
                          {savingNoteId === turn.id ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            <BookmarkPlus
                              className={cn(
                                "h-3 w-3",
                                noteSavedId === turn.id && "text-info",
                              )}
                            />
                          )}
                        </Button>
                      </div>
                      )}
                    {turn.role === "assistant" &&
                      feedbackCommentTurnId === turn.id &&
                      pendingFeedbackRating &&
                      turn.feedback == null && (
                        <form
                          className="mr-auto flex w-full max-w-[95%] flex-col gap-1.5"
                          onSubmit={(e) => {
                            e.preventDefault();
                            void onFeedback(
                              turn,
                              pendingFeedbackRating,
                              feedbackCommentDraft,
                            );
                          }}
                        >
                          <input
                            type="text"
                            value={feedbackCommentDraft}
                            onChange={(e) => setFeedbackCommentDraft(e.target.value)}
                            maxLength={200}
                            placeholder="Optional one-line reason"
                            className="h-8 rounded-md border border-border bg-background px-2 text-xs"
                            autoFocus
                          />
                          <div className="flex items-center gap-1.5">
                            <Button type="submit" size="sm" className="h-7 px-2 text-xs">
                              Submit
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              className="h-7 px-2 text-xs"
                              onClick={() =>
                                void onFeedback(turn, pendingFeedbackRating, undefined)
                              }
                            >
                              Skip
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              className="h-7 px-2 text-xs"
                              onClick={() => {
                                setFeedbackCommentTurnId(null);
                                setPendingFeedbackRating(null);
                                setFeedbackCommentDraft("");
                              }}
                            >
                              Cancel
                            </Button>
                          </div>
                        </form>
                      )}
                    {(turn.actions ?? [])
                      .filter((a) => !isAssistantUiAction(a.type))
                      .map((action) => {
                      const isFollowUp =
                        action.type === "apply_build_recipe" &&
                        /sync.*update|update.*build/i.test(
                          `${action.label} ${action.summary}`,
                        );
                      return (
                      <div
                        key={action.id}
                        ref={isFollowUp ? followUpCardRef : undefined}
                        className={cn(
                          "mr-auto w-full max-w-[95%] overflow-hidden rounded-xl border-2 bg-gradient-to-br via-card to-card p-0 text-sm shadow-md",
                          isFollowUp
                            ? "border-info/60 from-info/15 ring-2 ring-info/30"
                            : "border-info/40 from-info/10 ring-1 ring-info/20",
                        )}
                      >
                        <div className="flex items-start gap-2 border-b border-info/20 bg-info/5 px-3 py-2">
                          <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-info" aria-hidden />
                          <div className="min-w-0 flex-1">
                            <p className="text-[10px] font-semibold uppercase tracking-wide text-info">
                              {isFollowUp ? "Recommended next step" : "Action required"}
                            </p>
                            <p className="font-semibold text-foreground">{action.label}</p>
                          </div>
                          <span className="shrink-0 rounded-full bg-background/80 px-2 py-0.5 font-mono text-[10px] text-muted-foreground">
                            {action.type}
                          </span>
                        </div>
                        <div className="space-y-3 px-3 py-3">
                          <p className="text-xs leading-relaxed text-muted-foreground">
                            {action.summary}
                          </p>
                          {(() => {
                            const baseline = suggestedExcludesFor(action);
                            if (!baseline?.length || isFollowUp) return null;
                            const selected = resolvedExcludes(action);
                            return (
                              <div className="rounded-md border border-border/80 bg-muted/30 px-2.5 py-2">
                                <p className="text-[11px] font-medium text-foreground">
                                  Suggested excludes
                                </p>
                                <p className="mt-0.5 text-[10px] text-muted-foreground">
                                  Merged into kit exclude on Apply. Uncheck any you want to keep.
                                </p>
                                <ul className="mt-2 space-y-1.5">
                                  {baseline.map((tag) => {
                                    const checked = selected.includes(tag);
                                    return (
                                      <li key={tag}>
                                        <label className="flex cursor-pointer items-start gap-2 text-[11px]">
                                          <input
                                            type="checkbox"
                                            className="mt-0.5"
                                            checked={checked}
                                            disabled={applyingId === action.id || busy}
                                            onChange={(e) =>
                                              toggleExclude(
                                                action.id,
                                                tag,
                                                e.target.checked,
                                                baseline,
                                              )
                                            }
                                          />
                                          <span className="font-mono text-foreground">{tag}</span>
                                        </label>
                                      </li>
                                    );
                                  })}
                                </ul>
                                {selected.length === 0 && (
                                  <p className="mt-1.5 text-[10px] text-muted-foreground">
                                    None selected — Apply will not change exclude.
                                  </p>
                                )}
                              </div>
                            );
                          })()}
                          {action.params && Object.keys(action.params).length > 0 && !isFollowUp && (
                            <dl className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-1 rounded-md bg-muted/40 px-2 py-1.5 text-[11px]">
                              {actionParamRows(action)
                                .slice(0, 8)
                                .map(({ key, value }) => (
                                  <div key={key} className="contents">
                                    <dt className="font-medium text-muted-foreground">{key}</dt>
                                    <dd className="truncate font-mono text-foreground">{value}</dd>
                                  </div>
                                ))}
                            </dl>
                          )}
                          <div className="flex flex-wrap gap-2 pt-0.5">
                            <Button
                              type="button"
                              size="sm"
                              variant="info"
                              className="min-w-[5.5rem] font-semibold"
                              disabled={applyingId === action.id || busy}
                              onClick={() => void onApply(action, turn.id)}
                            >
                              {applyingId === action.id ? (
                                <>
                                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                                  {applyingHint ?? "Applying…"}
                                </>
                              ) : isFollowUp ? (
                                "Sync & update"
                              ) : (
                                "Apply"
                              )}
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              disabled={applyingId === action.id}
                              onClick={() => onDismiss(action, turn.id)}
                            >
                              Dismiss
                            </Button>
                          </div>
                        </div>
                      </div>
                      );
                      })}
                  </div>
                      ))}
                    </>
                  );
                })()}
                {error && (
                  <p className="text-sm text-destructive" role="alert">
                    {error}
                  </p>
                )}
                <div ref={bottomRef} />
              </div>
            </ScrollArea>

            <form
              onSubmit={onSubmit}
              className="flex shrink-0 items-end gap-2 border-t border-border p-3"
            >
              <label className="sr-only" htmlFor="assistant-draft">
                Message
              </label>
              <textarea
                id="assistant-draft"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                rows={2}
                disabled={busy || enabled === null || historyLoading}
                placeholder="Ask about kits, layers, or workflow…"
                className="min-h-[2.5rem] flex-1 resize-none rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void sendMessage(draft);
                  }
                }}
              />
              <Button
                type="submit"
                size="icon"
                disabled={busy || !draft.trim() || enabled === null || historyLoading}
                aria-label="Send"
              >
                {busy ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <SendHorizontal className="h-4 w-4" />
                )}
              </Button>
              {busy && (
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  aria-label="Stop"
                  onClick={() => {
                    abortRef.current?.abort();
                    setBusy(false);
                  }}
                >
                  <X className="h-4 w-4" />
                </Button>
              )}
            </form>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
