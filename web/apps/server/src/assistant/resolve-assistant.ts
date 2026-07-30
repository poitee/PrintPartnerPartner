import type { AiProviderId } from "@print-partner/contracts";
import type { ServerConfig } from "../config.js";
import type { AppRepository } from "../db/repository.js";
import { listIntegrationsByType } from "../integrations/store.js";

/** Runtime AI settings after resolving Settings integration vs env defaults. */
export type AssistantRuntimeConfig = {
  enabled: boolean;
  provider: AiProviderId;
  anthropicApiKey: string | null;
  openaiApiKey: string | null;
  openaiBaseUrl: string | null;
  ollamaUrl: string;
  aiModel: string | null;
  aiMaxTokens: number;
  /**
   * Include other accessible plans as few-shot *examples* in context.
   * This is NOT model training / fine-tuning.
   */
  useOtherBuildsAsExamples: boolean;
  /** Soft daily chat request cap per tenant (`0` = unlimited). */
  aiDailyRequestBudget: number;
  /** Soft daily estimated-token cap per tenant (`0` = unlimited). */
  aiDailyTokenBudget: number;
  /** Where the active provider settings came from. */
  source: "settings" | "env" | "none";
};

function parseProvider(raw: unknown): AiProviderId {
  if (raw === "anthropic" || raw === "openai" || raw === "ollama" || raw === "none") {
    return raw;
  }
  return "none";
}

function defaultModel(provider: AiProviderId, explicit: string | null): string | null {
  if (explicit) return explicit;
  if (provider === "anthropic") return "claude-sonnet-4-20250514";
  if (provider === "openai") return "gpt-4o-mini";
  if (provider === "ollama") return "llama3.1";
  return null;
}

function normalizeUrl(raw: unknown): string | null {
  if (typeof raw !== "string" || !raw.trim()) return null;
  // Repair accidental `http:/host` (one slash) → `http://host`
  return raw
    .trim()
    .replace(/^(https?):\/(?!\/)/i, "$1://")
    .replace(/\/+$/, "");
}

function stringOrNull(raw: unknown): string | null {
  if (typeof raw !== "string" || !raw.trim()) return null;
  return raw.trim();
}

function credentialsOk(
  provider: AiProviderId,
  apiKey: string | null,
): boolean {
  if (provider === "anthropic" || provider === "openai") return Boolean(apiKey);
  if (provider === "ollama") return true;
  return false;
}

function boolOrDefault(raw: unknown, fallback: boolean): boolean {
  if (raw === false || raw === "false" || raw === 0 || raw === "0") return false;
  if (raw === true || raw === "true" || raw === 1 || raw === "1") return true;
  return fallback;
}

function positiveIntOrDefault(raw: unknown, fallback: number): number {
  if (typeof raw === "number" && Number.isFinite(raw) && raw >= 0) {
    return Math.trunc(raw);
  }
  if (typeof raw === "string" && raw.trim() && Number.isFinite(Number(raw))) {
    const n = Number(raw);
    if (n >= 0) return Math.trunc(n);
  }
  return fallback;
}

/** Prefer explicit settings value; missing/null falls back to env. */
function budgetOrEnv(raw: unknown, envFallback: number): number {
  if (raw === undefined || raw === null || raw === "") return envFallback;
  return positiveIntOrDefault(raw, envFallback);
}

function fromEnv(config: ServerConfig): AssistantRuntimeConfig {
  return {
    enabled: config.aiEnabled,
    provider: config.aiProvider,
    anthropicApiKey: config.anthropicApiKey,
    openaiApiKey: config.openaiApiKey,
    openaiBaseUrl: config.openaiBaseUrl,
    ollamaUrl: config.ollamaUrl,
    aiModel: config.aiModel,
    aiMaxTokens: config.aiMaxTokens,
    useOtherBuildsAsExamples: true,
    aiDailyRequestBudget: config.aiDailyRequestBudget,
    aiDailyTokenBudget: config.aiDailyTokenBudget,
    source: config.aiEnabled ? "env" : "none",
  };
}

/**
 * Prefer an enabled Settings → AI Assistant integration when present and valid;
 * otherwise fall back to env (`AI_ENABLED` / `AI_PROVIDER` / keys).
 */
export function resolveAssistantRuntime(
  repo: AppRepository,
  env: ServerConfig,
): AssistantRuntimeConfig {
  const items = listIntegrationsByType(repo, "ai_assistant");
  for (const item of items) {
    if (item.config.enabled === false) continue;

    const provider = parseProvider(item.config.provider);
    if (provider === "none") continue;

    const apiKey = stringOrNull(item.config.api_key ?? item.config.apiKey);
    if (!credentialsOk(provider, apiKey)) continue;

    const model = defaultModel(provider, stringOrNull(item.config.model));
    const baseUrl = normalizeUrl(
      item.config.base_url ??
        item.config.ollama_url ??
        item.config.baseUrl ??
        item.config.ollamaUrl,
    );
    const maxTokensRaw = item.config.max_tokens ?? item.config.maxTokens;
    const maxTokens =
      typeof maxTokensRaw === "number" && Number.isFinite(maxTokensRaw) && maxTokensRaw > 0
        ? Math.trunc(maxTokensRaw)
        : env.aiMaxTokens;

    const useOtherBuildsAsExamples = boolOrDefault(
      item.config.use_other_builds_as_examples ?? item.config.useOtherBuildsAsExamples,
      true,
    );

    const requestBudget = budgetOrEnv(
      item.config.daily_request_budget ?? item.config.dailyRequestBudget,
      env.aiDailyRequestBudget,
    );
    const tokenBudget = budgetOrEnv(
      item.config.daily_token_budget ?? item.config.dailyTokenBudget,
      env.aiDailyTokenBudget,
    );

    return {
      enabled: true,
      provider,
      anthropicApiKey: provider === "anthropic" ? apiKey : null,
      openaiApiKey: provider === "openai" ? apiKey : null,
      openaiBaseUrl:
        provider === "openai" ? baseUrl ?? env.openaiBaseUrl ?? "https://api.openai.com" : null,
      ollamaUrl: provider === "ollama" ? baseUrl ?? env.ollamaUrl : env.ollamaUrl,
      aiModel: model,
      aiMaxTokens: maxTokens,
      useOtherBuildsAsExamples,
      aiDailyRequestBudget: requestBudget,
      aiDailyTokenBudget: tokenBudget,
      source: "settings",
    };
  }

  return fromEnv(env);
}
