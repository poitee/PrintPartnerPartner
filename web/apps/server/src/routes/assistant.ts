import type { FastifyInstance } from "fastify";
import type {
  AssistantActionApplyRequest,
  AssistantChatMessage,
  AssistantChatRequest,
  AssistantFeedbackRequest,
  AssistantProposedAction,
  AssistantStatus,
} from "@print-partner/contracts";
import { isAssistantUiAction } from "@print-partner/contracts";
import type { ServerConfig } from "../config.js";
import type { AppRepository } from "../db/repository.js";
import type { InProcessJobRunner } from "./jobs.js";
import { createAssistantPort } from "../assistant/create-assistant.js";
import { resolveAssistantRuntime } from "../assistant/resolve-assistant.js";
import { buildAssistantSystemPrompt } from "../assistant/assistant-context.js";
import { runAssistantTurn } from "../assistant/tool-loop.js";
import { recoverProposedActionsFromText } from "../assistant/recover-proposals-from-text.js";
import { applyAssistantAction } from "../assistant/tools.js";
import {
  appendAssistantFeedback,
  appendAssistantHistory,
  appendPendingProposedActions,
  clearAssistantHistory,
  loadAssistantHistory,
  removePendingProposedAction,
} from "../assistant/history.js";
import {
  checkDailyBudget,
  estimateTokens,
  loadDailyUsage,
  recordDailyUsage,
} from "../assistant/usage.js";
import {
  importAssistantDomainPack,
  loadAssistantDomainPack,
  type DomainImportPayload,
} from "../assistant/domain-pack.js";
import { sendProblem } from "../lib/api-error.js";
import type { ToolContext } from "../assistant/tools.js";

async function recoverFakeRecipeIfNeeded(
  content: string,
  proposedActions: AssistantProposedAction[],
  toolCtx: ToolContext,
): Promise<{ content: string; proposedActions: AssistantProposedAction[] }> {
  if (proposedActions.length > 0 || !content.trim()) {
    return { content, proposedActions };
  }
  const recovered = await recoverProposedActionsFromText(content, toolCtx);
  if (!recovered.actions.length && recovered.cleanedContent === content) {
    return { content, proposedActions };
  }
  return {
    content: recovered.cleanedContent,
    proposedActions: [...proposedActions, ...recovered.actions],
  };
}

function persistTurnHistory(
  repo: AppRepository,
  chatMessages: AssistantChatMessage[],
  assistantContent: string,
  proposedActions: AssistantProposedAction[],
): void {
  const lastUser = [...chatMessages].reverse().find((m) => m.role === "user");
  if (!lastUser) return;
  if (!assistantContent && proposedActions.length === 0) return;
  const pending = proposedActions.filter((a) => !isAssistantUiAction(a.type));
  appendAssistantHistory(repo, [
    { role: "user", content: lastUser.content },
    {
      role: "assistant",
      content: assistantContent,
      ...(pending.length ? { proposed_actions: pending } : {}),
    },
  ]);
}

const MAX_MESSAGES = 40;
const MAX_CONTENT_CHARS = 8000;

type RouteDeps = {
  repo: AppRepository;
  config: ServerConfig;
  jobs: InProcessJobRunner;
};

function sanitizeMessages(raw: unknown): AssistantChatMessage[] | null {
  if (!Array.isArray(raw)) return null;
  const out: AssistantChatMessage[] = [];
  for (const item of raw.slice(-MAX_MESSAGES)) {
    if (!item || typeof item !== "object") continue;
    const role = (item as { role?: unknown }).role;
    const content = (item as { content?: unknown }).content;
    if (role !== "user" && role !== "assistant" && role !== "system") continue;
    if (typeof content !== "string") continue;
    const trimmed = content.trim();
    if (!trimmed) continue;
    out.push({
      role,
      content: trimmed.slice(0, MAX_CONTENT_CHARS),
    });
  }
  return out;
}

function writeSse(raw: NodeJS.WritableStream, event: string, data: unknown): void {
  raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

function resolveUseExamples(
  body: AssistantChatRequest,
  runtimeDefault: boolean,
): boolean {
  if (typeof body.use_other_builds_as_examples === "boolean") {
    return body.use_other_builds_as_examples;
  }
  return runtimeDefault;
}

function emitContentAsTokens(
  raw: NodeJS.WritableStream,
  content: string,
): void {
  // Chunk for smoother UI without true streaming from the tool path.
  const size = 48;
  for (let i = 0; i < content.length; i += size) {
    writeSse(raw, "token", { text: content.slice(i, i + size) });
  }
}

function estimateTurnTokens(
  messages: AssistantChatMessage[],
  completionMax: number,
): number {
  let total = 0;
  for (const m of messages) total += estimateTokens(m.content);
  return total + Math.max(0, completionMax);
}

function tokensActuallyUsed(
  messages: AssistantChatMessage[],
  replyContent: string,
): number {
  let total = 0;
  for (const m of messages) total += estimateTokens(m.content);
  return total + estimateTokens(replyContent);
}

export async function registerAssistantRoutes(
  app: FastifyInstance,
  deps: RouteDeps,
): Promise<void> {
  app.get("/assistant/status", async (): Promise<AssistantStatus> => {
    const runtime = resolveAssistantRuntime(deps.repo, deps.config);
    const assistant = createAssistantPort(runtime);
    const usage = loadDailyUsage(deps.repo);
    return {
      enabled: assistant.configured && runtime.enabled,
      provider: assistant.provider,
      model: assistant.model,
      use_other_builds_as_examples: runtime.useOtherBuildsAsExamples,
      tools_supported: assistant.supportsTools,
      daily_request_budget: runtime.aiDailyRequestBudget || null,
      daily_token_budget: runtime.aiDailyTokenBudget || null,
      daily_requests_used: usage.requests,
      daily_tokens_used: usage.tokens,
    };
  });

  app.get("/assistant/history", async () => {
    return { messages: loadAssistantHistory(deps.repo) };
  });

  app.delete("/assistant/history", async () => {
    clearAssistantHistory(deps.repo);
    return { ok: true };
  });

  app.post(
    "/assistant/feedback",
    { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const body = (request.body ?? {}) as AssistantFeedbackRequest;
      if (body.rating !== "up" && body.rating !== "down") {
        return sendProblem(reply, 400, "Bad Request", "rating must be up or down");
      }
      const entry = appendAssistantFeedback(deps.repo, {
        rating: body.rating,
        message_excerpt: body.message_excerpt,
        plan_id: typeof body.plan_id === "number" ? body.plan_id : undefined,
        comment: body.comment,
      });
      return { ok: true, id: entry.id };
    },
  );

  app.post(
    "/assistant/actions/apply",
    { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const body = (request.body ?? {}) as AssistantActionApplyRequest;
      const action = body.action as AssistantProposedAction | undefined;
      if (!action || typeof action !== "object" || typeof action.type !== "string") {
        return sendProblem(reply, 400, "Bad Request", "action is required");
      }
      if (typeof action.plan_id !== "number" || !Number.isFinite(action.plan_id)) {
        return sendProblem(reply, 400, "Bad Request", "action.plan_id is required");
      }
      const result = await applyAssistantAction(action, {
        repo: deps.repo,
        jobs: deps.jobs,
        tenantId: request.tenantId,
      });
      if (!result.ok) {
        return sendProblem(reply, 400, "Bad Request", result.detail ?? "Action failed");
      }
      removePendingProposedAction(deps.repo, action.id);
      const followUp =
        result.result &&
        typeof result.result === "object" &&
        (result.result as { follow_up_action?: AssistantProposedAction }).follow_up_action;
      if (
        followUp &&
        typeof followUp === "object" &&
        typeof followUp.type === "string" &&
        !isAssistantUiAction(followUp.type)
      ) {
        appendPendingProposedActions(deps.repo, [followUp]);
      }
      return result;
    },
  );

  app.post(
    "/assistant/actions/dismiss",
    { config: { rateLimit: { max: 40, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const body = (request.body ?? {}) as { action?: AssistantProposedAction };
      const action = body.action;
      if (!action || typeof action !== "object" || typeof action.type !== "string") {
        return sendProblem(reply, 400, "Bad Request", "action is required");
      }
      if (typeof action.plan_id !== "number" || !Number.isFinite(action.plan_id)) {
        return sendProblem(reply, 400, "Bad Request", "action.plan_id is required");
      }
      const { logDismissedAction } = await import("../services/plan-decisions.js");
      const entry = logDismissedAction(deps.repo, action);
      removePendingProposedAction(deps.repo, action.id);
      return { ok: true, decision: entry };
    },
  );

  app.post(
    "/assistant/chat",
    { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const runtime = resolveAssistantRuntime(deps.repo, deps.config);
      const assistant = createAssistantPort(runtime);
      if (!runtime.enabled || !assistant.configured) {
        return sendProblem(
          reply,
          503,
          "Service Unavailable",
          "AI assistant is disabled. Configure it under Settings → Optional integrations, or set AI_ENABLED=1 with AI_PROVIDER.",
        );
      }

      const body = (request.body ?? {}) as AssistantChatRequest;
      const messages = sanitizeMessages(body.messages);
      if (!messages || messages.length === 0) {
        return sendProblem(reply, 400, "Bad Request", "messages must be a non-empty array");
      }
      if (!messages.some((m) => m.role === "user")) {
        return sendProblem(reply, 400, "Bad Request", "at least one user message is required");
      }

      const planId =
        typeof body.plan_id === "number" && Number.isFinite(body.plan_id)
          ? Math.trunc(body.plan_id)
          : null;
      if (planId != null && planId > 0 && !deps.repo.getProfile(planId)) {
        return sendProblem(reply, 404, "Not Found", "Plan not found");
      }

      const useExamples = resolveUseExamples(body, runtime.useOtherBuildsAsExamples);
      const model = (runtime.aiModel ?? assistant.model ?? "").trim();
      if (!model) {
        return sendProblem(
          reply,
          400,
          "Bad Request",
          "AI model is not configured. Set Model under Settings → Optional integrations → AI assistant (for Ollama, use an exact name from `ollama list`).",
        );
      }

      const chatMessages = messages.filter((m) => m.role !== "system");
      const wantStream = body.stream !== false;
      const activePlanId = planId && planId > 0 ? planId : null;

      const budgetGate = checkDailyBudget(
        deps.repo,
        {
          requestBudget: runtime.aiDailyRequestBudget,
          tokenBudget: runtime.aiDailyTokenBudget,
        },
        estimateTurnTokens(chatMessages, runtime.aiMaxTokens),
      );
      if (!budgetGate.ok) {
        return sendProblem(reply, 429, "Too Many Requests", budgetGate.detail);
      }

      const runTurn = async () => {
        const systemForTools = buildAssistantSystemPrompt({
          repo: deps.repo,
          planId: activePlanId,
          useOtherBuildsAsExamples: useExamples,
          toolsAvailable: true,
          dataDir: deps.config.dataDir,
        });

        try {
          const turn = await runAssistantTurn({
            assistant,
            system: systemForTools,
            messages: chatMessages,
            model,
            maxTokens: runtime.aiMaxTokens,
            toolCtx: {
              repo: deps.repo,
              activePlanId,
              useOtherBuildsAsExamples: useExamples,
              dataDir: deps.config.dataDir,
              assistant,
            },
          });

          if (!turn.toolsDegraded) {
            return turn;
          }
        } catch (e) {
          const toolsUnsupported =
            e instanceof Error &&
            (e as Error & { toolsUnsupported?: boolean }).toolsUnsupported === true;
          if (!toolsUnsupported) throw e;
          // fall through to degraded path
        }

        const systemDegraded = buildAssistantSystemPrompt({
          repo: deps.repo,
          planId: activePlanId,
          useOtherBuildsAsExamples: useExamples,
          toolsDegraded: true,
          dataDir: deps.config.dataDir,
        });
        const content = await assistant.complete({
          system: systemDegraded,
          messages: chatMessages,
          model,
          maxTokens: runtime.aiMaxTokens,
        });
        const toolCtx = {
          repo: deps.repo,
          activePlanId,
          useOtherBuildsAsExamples: useExamples,
          dataDir: deps.config.dataDir,
          assistant,
        };
        const recovered = await recoverFakeRecipeIfNeeded(content, [], toolCtx);
        return {
          content: recovered.content,
          proposedActions: recovered.proposedActions,
          toolsDegraded: true,
        };
      };

      if (!wantStream) {
        try {
          const turn = await runTurn();
          persistTurnHistory(deps.repo, chatMessages, turn.content, turn.proposedActions);
          recordDailyUsage(
            deps.repo,
            tokensActuallyUsed(chatMessages, turn.content),
          );
          return {
            message: { role: "assistant" as const, content: turn.content },
            proposed_actions: turn.proposedActions,
            tools_degraded: turn.toolsDegraded,
          };
        } catch (e) {
          const detail = e instanceof Error ? e.message : String(e);
          request.log.warn({ err: detail }, "assistant chat failed");
          return sendProblem(reply, 502, "Bad Gateway", detail || "Assistant provider request failed");
        }
      }

      reply.hijack();
      reply.raw.writeHead(200, {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      });

      try {
        // Prefer tool loop (non-stream complete), then emit tokens + actions.
        let turn;
        try {
          const systemForTools = buildAssistantSystemPrompt({
            repo: deps.repo,
            planId: activePlanId,
            useOtherBuildsAsExamples: useExamples,
            toolsAvailable: true,
            dataDir: deps.config.dataDir,
          });
          turn = await runAssistantTurn({
            assistant,
            system: systemForTools,
            messages: chatMessages,
            model,
            maxTokens: runtime.aiMaxTokens,
            toolCtx: {
              repo: deps.repo,
              activePlanId,
              useOtherBuildsAsExamples: useExamples,
              dataDir: deps.config.dataDir,
              assistant,
            },
          });
        } catch (e) {
          const toolsUnsupported =
            e instanceof Error &&
            (e as Error & { toolsUnsupported?: boolean }).toolsUnsupported === true;
          if (!toolsUnsupported) throw e;
          turn = { content: "", proposedActions: [], toolsDegraded: true };
        }

        if (turn.toolsDegraded) {
          writeSse(reply.raw, "meta", {
            tools_degraded: true,
            note: "Model/provider does not support tools; using stuffed context.",
          });
          const systemDegraded = buildAssistantSystemPrompt({
            repo: deps.repo,
            planId: activePlanId,
            useOtherBuildsAsExamples: useExamples,
            toolsDegraded: true,
            dataDir: deps.config.dataDir,
          });
          let failed = false;
          let assembled = "";
          await assistant.stream(
            {
              system: systemDegraded,
              messages: chatMessages,
              model,
              maxTokens: runtime.aiMaxTokens,
            },
            {
              onToken(text) {
                assembled += text;
                writeSse(reply.raw, "token", { text });
              },
              onDone() {
                /* finalized below */
              },
              onError(error) {
                failed = true;
                request.log.warn({ err: error.message }, "assistant stream failed");
                writeSse(reply.raw, "error", {
                  detail: error.message || "Assistant provider request failed",
                });
                reply.raw.end();
              },
            },
          );
          if (failed) return;
          const toolCtx = {
            repo: deps.repo,
            activePlanId,
            useOtherBuildsAsExamples: useExamples,
            dataDir: deps.config.dataDir,
            assistant,
          };
          const recovered = await recoverFakeRecipeIfNeeded(assembled, [], toolCtx);
          for (const action of recovered.proposedActions) {
            writeSse(reply.raw, "action", { action });
          }
          persistTurnHistory(
            deps.repo,
            chatMessages,
            recovered.content,
            recovered.proposedActions,
          );
          recordDailyUsage(deps.repo, tokensActuallyUsed(chatMessages, recovered.content));
          writeSse(reply.raw, "done", {
            ok: true,
            tools_degraded: true,
            final_content: recovered.content,
            proposed_actions: recovered.proposedActions,
          });
          reply.raw.end();
          return;
        }

        for (const action of turn.proposedActions) {
          writeSse(reply.raw, "action", { action });
        }
        if (turn.toolsDegraded) {
          writeSse(reply.raw, "meta", { tools_degraded: true });
        }
        emitContentAsTokens(reply.raw, turn.content);
        persistTurnHistory(deps.repo, chatMessages, turn.content, turn.proposedActions);
        recordDailyUsage(deps.repo, tokensActuallyUsed(chatMessages, turn.content));
        writeSse(reply.raw, "done", {
          ok: true,
          tools_degraded: false,
          proposed_actions: turn.proposedActions,
        });
        reply.raw.end();
      } catch (e) {
        const detail = e instanceof Error ? e.message : String(e);
        request.log.warn({ err: detail }, "assistant stream failed");
        writeSse(reply.raw, "error", {
          detail: detail || "Assistant provider request failed",
        });
        reply.raw.end();
      }
    },
  );

  app.get("/assistant/domain", async () => {
    const pack = loadAssistantDomainPack({ dataDir: deps.config.dataDir });
    return {
      loaded: Boolean(pack),
      chars: pack.length,
      preview: pack.slice(0, 500),
    };
  });

  app.post(
    "/assistant/domain/import",
    { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const body = (request.body ?? {}) as DomainImportPayload;
      if (!body || typeof body !== "object") {
        return sendProblem(reply, 400, "Bad Request", "JSON body required");
      }
      try {
        const result = importAssistantDomainPack(body, {
          dataDir: deps.config.dataDir,
          repo: deps.repo,
        });
        return result;
      } catch (e) {
        const detail = e instanceof Error ? e.message : String(e);
        return sendProblem(reply, 400, "Bad Request", detail);
      }
    },
  );
}
