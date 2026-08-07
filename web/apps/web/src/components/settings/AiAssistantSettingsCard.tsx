import { useCallback, useEffect, useMemo, useState } from "react";
import {
  createIntegration,
  deleteIntegration,
  fetchAssistantStatus,
  fetchIntegrations,
  testIntegration,
  updateIntegration,
  type IntegrationSummary,
} from "../../api/engine";
import type { AssistantStatus, SearchProviderId } from "@print-partner/contracts";
import { Button } from "../ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select";

type Props = {
  engineReady: boolean;
};

type AiProviderChoice = "ollama" | "openai" | "anthropic";

/** UI search choices; `auto` means no Settings override (env / native resolution). */
type SearchProviderChoice = "auto" | "duckduckgo" | "brave" | "exa" | "none";

const DEFAULT_GUIDE_MAX_KB = 512;
const DEFAULT_OLLAMA_CTX = 16384;
const DEFAULT_MAX_TOKENS = 2048;

function parseSearchChoice(raw: unknown): SearchProviderChoice {
  if (raw === "duckduckgo" || raw === "brave" || raw === "exa" || raw === "none") {
    return raw;
  }
  return "auto";
}

function searchChoiceToConfig(choice: SearchProviderChoice): SearchProviderId | null {
  return choice === "auto" ? null : choice;
}

export default function AiAssistantSettingsCard({ engineReady }: Props) {
  const [aiItem, setAiItem] = useState<IntegrationSummary | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);
  const [assistantStatus, setAssistantStatus] = useState<AssistantStatus | null>(null);

  const [aiName, setAiName] = useState("Kit advisor");
  const [aiProvider, setAiProvider] = useState<AiProviderChoice>("ollama");
  const [aiBaseUrl, setAiBaseUrl] = useState("http://127.0.0.1:11434");
  const [aiModel, setAiModel] = useState("llama3.1");
  const [aiApiKey, setAiApiKey] = useState("");
  const [aiUseOtherBuilds, setAiUseOtherBuilds] = useState(true);
  const [aiMaxTokens, setAiMaxTokens] = useState(String(DEFAULT_MAX_TOKENS));
  const [aiDailyRequestBudget, setAiDailyRequestBudget] = useState("");
  const [aiDailyTokenBudget, setAiDailyTokenBudget] = useState("");
  const [aiEnabled, setAiEnabled] = useState(true);

  const [searchProvider, setSearchProvider] = useState<SearchProviderChoice>("auto");
  const [searchApiKey, setSearchApiKey] = useState("");

  const [allowUrlIngest, setAllowUrlIngest] = useState(true);
  const [guideMaxKb, setGuideMaxKb] = useState(String(DEFAULT_GUIDE_MAX_KB));

  const [ollamaNumCtx, setOllamaNumCtx] = useState(String(DEFAULT_OLLAMA_CTX));

  const refresh = useCallback(async () => {
    if (!engineReady) return;
    setLoadError(null);
    try {
      const [integrations, status] = await Promise.all([
        fetchIntegrations(),
        fetchAssistantStatus().catch(() => null),
      ]);
      const item =
        integrations
          .filter((i) => i.type === "ai_assistant")
          .sort((a, b) => b.updated_at.localeCompare(a.updated_at))[0] ?? null;
      setAiItem(item);
      setAssistantStatus(status);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
    }
  }, [engineReady]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!aiItem) return;
    const cfg = aiItem.config;
    setAiName(aiItem.name);
    setAiProvider((cfg.provider as AiProviderChoice) || "ollama");
    setAiModel(String(cfg.model ?? ""));
    setAiBaseUrl(
      String(cfg.base_url ?? cfg.ollama_url ?? cfg.baseUrl ?? "") ||
        "http://127.0.0.1:11434",
    );
    setAiApiKey("");
    setAiUseOtherBuilds(cfg.use_other_builds_as_examples !== false);
    setAiEnabled(cfg.enabled !== false);

    const maxTok = cfg.max_tokens ?? cfg.maxTokens;
    setAiMaxTokens(
      typeof maxTok === "number" && maxTok > 0 ? String(maxTok) : String(DEFAULT_MAX_TOKENS),
    );

    const reqBudget = cfg.daily_request_budget ?? cfg.dailyRequestBudget;
    const tokBudget = cfg.daily_token_budget ?? cfg.dailyTokenBudget;
    setAiDailyRequestBudget(
      typeof reqBudget === "number" && reqBudget > 0 ? String(reqBudget) : "",
    );
    setAiDailyTokenBudget(
      typeof tokBudget === "number" && tokBudget > 0 ? String(tokBudget) : "",
    );

    setSearchProvider(parseSearchChoice(cfg.search_provider ?? cfg.searchProvider));
    setSearchApiKey("");

    const allowRaw = cfg.allow_url_ingest ?? cfg.allowUrlIngest;
    setAllowUrlIngest(allowRaw === false || allowRaw === "false" || allowRaw === 0 ? false : true);

    const guideBytes = cfg.guide_ingest_max_bytes ?? cfg.guideIngestMaxBytes;
    if (typeof guideBytes === "number" && guideBytes > 0) {
      setGuideMaxKb(String(Math.max(1, Math.round(guideBytes / 1024))));
    } else {
      setGuideMaxKb(String(DEFAULT_GUIDE_MAX_KB));
    }

    const ctxRaw = cfg.ollama_num_ctx ?? cfg.ollamaNumCtx;
    setOllamaNumCtx(
      typeof ctxRaw === "number" && ctxRaw >= 2048 ? String(ctxRaw) : String(DEFAULT_OLLAMA_CTX),
    );
  }, [aiItem]);

  useEffect(() => {
    if (aiItem) return;
    if (aiProvider === "ollama") {
      setAiBaseUrl((prev) => (prev.trim() ? prev : "http://127.0.0.1:11434"));
      setAiModel((prev) => (prev.trim() ? prev : "llama3.1"));
    } else if (aiProvider === "openai") {
      setAiBaseUrl((prev) =>
        prev.trim() && !prev.includes("11434") ? prev : "https://api.openai.com",
      );
      setAiModel((prev) => (prev.trim() && prev !== "llama3.1" ? prev : "gpt-4o-mini"));
    } else {
      setAiModel((prev) =>
        prev.trim() && prev !== "llama3.1" && prev !== "gpt-4o-mini"
          ? prev
          : "claude-sonnet-4-20250514",
      );
    }
  }, [aiProvider, aiItem]);

  const buildConfig = useCallback(
    (opts: { includeApiKey: boolean; includeSearchKey: boolean; forCreate: boolean }) => {
      const model = aiModel.trim();
      const config: Record<string, unknown> = {
        provider: aiProvider,
        model,
        enabled: aiEnabled,
        use_other_builds_as_examples: aiUseOtherBuilds,
        allow_url_ingest: allowUrlIngest,
        search_provider: searchChoiceToConfig(searchProvider),
      };

      if (aiProvider === "ollama" || aiProvider === "openai") {
        config.base_url =
          aiBaseUrl.trim() ||
          (aiProvider === "ollama" ? "http://127.0.0.1:11434" : "https://api.openai.com");
      }

      if (opts.includeApiKey && (aiProvider === "openai" || aiProvider === "anthropic")) {
        const key = aiApiKey.trim();
        if (key) config.api_key = key;
      }

      const maxTok = Number(aiMaxTokens);
      config.max_tokens =
        Number.isFinite(maxTok) && maxTok > 0 ? Math.trunc(maxTok) : DEFAULT_MAX_TOKENS;

      const reqBudget = Number(aiDailyRequestBudget);
      if (opts.forCreate) {
        if (Number.isFinite(reqBudget) && reqBudget > 0) {
          config.daily_request_budget = Math.trunc(reqBudget);
        }
      } else {
        config.daily_request_budget =
          Number.isFinite(reqBudget) && reqBudget > 0 ? Math.trunc(reqBudget) : null;
      }

      const tokBudget = Number(aiDailyTokenBudget);
      if (opts.forCreate) {
        if (Number.isFinite(tokBudget) && tokBudget > 0) {
          config.daily_token_budget = Math.trunc(tokBudget);
        }
      } else {
        config.daily_token_budget =
          Number.isFinite(tokBudget) && tokBudget > 0 ? Math.trunc(tokBudget) : null;
      }

      if (opts.includeSearchKey && (searchProvider === "brave" || searchProvider === "exa")) {
        const key = searchApiKey.trim();
        if (key) config.search_api_key = key;
      }

      const kb = Number(guideMaxKb);
      config.guide_ingest_max_bytes =
        Number.isFinite(kb) && kb > 0
          ? Math.trunc(kb * 1024)
          : DEFAULT_GUIDE_MAX_KB * 1024;

      if (aiProvider === "ollama") {
        const ctx = Number(ollamaNumCtx);
        config.ollama_num_ctx =
          Number.isFinite(ctx) && ctx >= 2048 ? Math.trunc(ctx) : DEFAULT_OLLAMA_CTX;
      }

      return config;
    },
    [
      aiProvider,
      aiModel,
      aiEnabled,
      aiUseOtherBuilds,
      allowUrlIngest,
      searchProvider,
      aiBaseUrl,
      aiApiKey,
      aiMaxTokens,
      aiDailyRequestBudget,
      aiDailyTokenBudget,
      searchApiKey,
      guideMaxKb,
      ollamaNumCtx,
    ],
  );

  const onAdd = async () => {
    const name = aiName.trim();
    const model = aiModel.trim();
    if (!name || !model) return;
    if ((aiProvider === "openai" || aiProvider === "anthropic") && !aiApiKey.trim()) return;
    if (
      (searchProvider === "brave" || searchProvider === "exa") &&
      !searchApiKey.trim()
    ) {
      // Allow save without key (env fallback); no hard block.
    }
    setBusy(true);
    setMessage(null);
    setLoadError(null);
    try {
      await createIntegration({
        type: "ai_assistant",
        name,
        config: buildConfig({ includeApiKey: true, includeSearchKey: true, forCreate: true }),
      });
      setAiApiKey("");
      setSearchApiKey("");
      setMessage(
        "AI assistant saved. Settings take precedence over env; env remains the operator fallback.",
      );
      await refresh();
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const onSave = async () => {
    if (!aiItem) return;
    const model = aiModel.trim();
    if (!model) return;
    setBusy(true);
    setMessage(null);
    setLoadError(null);
    try {
      await updateIntegration(aiItem.id, {
        name: aiName.trim() || aiItem.name,
        config: buildConfig({
          includeApiKey: Boolean(aiApiKey.trim()),
          includeSearchKey: Boolean(searchApiKey.trim()),
          forCreate: false,
        }),
      });
      setAiApiKey("");
      setSearchApiKey("");
      setMessage("AI assistant updated.");
      await refresh();
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const onTest = async () => {
    if (!aiItem) return;
    setTesting(true);
    setMessage(null);
    setLoadError(null);
    try {
      const result = await testIntegration(aiItem.id);
      setMessage(result.ok ? result.message ?? "Connected." : result.message ?? "Test failed.");
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
    } finally {
      setTesting(false);
    }
  };

  const onDelete = async () => {
    if (!aiItem) return;
    setBusy(true);
    setLoadError(null);
    try {
      await deleteIntegration(aiItem.id);
      setAiItem(null);
      setMessage("AI assistant removed. Env defaults apply if configured.");
      await refresh();
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const inputClass =
    "rounded-md border border-input bg-background px-2 py-1.5 text-sm w-full";

  const aiNeedsKey = aiProvider === "openai" || aiProvider === "anthropic";
  const searchNeedsKey = searchProvider === "brave" || searchProvider === "exa";
  const canCreate =
    Boolean(aiName.trim() && aiModel.trim()) && (!aiNeedsKey || Boolean(aiApiKey.trim()));

  const statusLine = useMemo(() => {
    if (!assistantStatus) return null;
    const parts = [
      assistantStatus.enabled ? "Enabled" : "Disabled",
      assistantStatus.provider,
      assistantStatus.model ?? "no model",
      assistantStatus.tools_supported ? "tools" : "no tools",
      `source: ${assistantStatus.source ?? "unknown"}`,
    ];
    return parts.join(" · ");
  }, [assistantStatus]);

  const usageLine = useMemo(() => {
    if (!assistantStatus) return null;
    const reqCap = assistantStatus.daily_request_budget;
    const tokCap = assistantStatus.daily_token_budget;
    if (!reqCap && !tokCap) return null;
    const bits: string[] = [];
    if (reqCap) {
      bits.push(
        `requests ${assistantStatus.daily_requests_used ?? 0}/${reqCap}`,
      );
    }
    if (tokCap) {
      bits.push(`tokens ${assistantStatus.daily_tokens_used ?? 0}/${tokCap}`);
    }
    return bits.join(" · ");
  }, [assistantStatus]);

  return (
    <Card id="ai-assistant" className="shadow-none">
      <CardHeader>
        <CardTitle className="text-base">AI assistant</CardTitle>
        <CardDescription>
          Kit advisor provider, budgets, web search, and URL research. Saved per tenant;
          process env is the operator fallback when a field is left unset.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6 text-sm">
        {loadError && <p className="text-destructive">{loadError}</p>}
        {message && <p className="text-muted-foreground">{message}</p>}

        {/* Status */}
        <section className="space-y-2">
          <p className="font-semibold">Status</p>
          {statusLine ? (
            <p className="text-muted-foreground">{statusLine}</p>
          ) : (
            <p className="text-muted-foreground">
              {engineReady ? "No status yet — configure a provider below." : "Waiting for engine…"}
            </p>
          )}
          {usageLine && (
            <p className="text-xs text-muted-foreground">Daily usage (UTC): {usageLine}</p>
          )}
          {assistantStatus?.search && (
            <p className="text-xs text-muted-foreground">
              Active search:{" "}
              <span className="font-mono text-foreground">
                {assistantStatus.search.provider}
              </span>
              {!assistantStatus.search.configured && (
                <span className="ml-1 text-amber-700 dark:text-amber-400">
                  (not configured)
                </span>
              )}
            </p>
          )}
        </section>

        {/* Provider */}
        <section className="space-y-2 rounded-md border border-border p-3">
          <p className="font-semibold">Provider</p>
          <label className="block">
            <span className="mb-1 block text-muted-foreground">Name</span>
            <input
              className={inputClass}
              value={aiName}
              onChange={(e) => setAiName(e.target.value)}
              placeholder="Kit advisor"
              disabled={!engineReady || busy}
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-muted-foreground">Provider</span>
            <Select
              value={aiProvider}
              onValueChange={(v) => setAiProvider(v as AiProviderChoice)}
              disabled={!engineReady || busy}
            >
              <SelectTrigger className="min-h-10 w-full max-w-none sm:max-w-md">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ollama">Ollama (local)</SelectItem>
                <SelectItem value="openai">OpenAI / compatible</SelectItem>
                <SelectItem value="anthropic">Anthropic</SelectItem>
              </SelectContent>
            </Select>
          </label>
          {aiProvider === "ollama" && (
            <p className="text-xs text-muted-foreground">
              Docker Compose: use{" "}
              <span className="font-mono text-foreground">http://host.docker.internal:11434</span>
              {" "}(not 127.0.0.1). On the host, run Ollama with{" "}
              <span className="font-mono text-foreground">OLLAMA_HOST=0.0.0.0</span>.
            </p>
          )}
          {(aiProvider === "ollama" || aiProvider === "openai") && (
            <label className="block">
              <span className="mb-1 block text-muted-foreground">
                {aiProvider === "ollama" ? "Ollama URL" : "Base URL"}
              </span>
              <input
                className={inputClass}
                value={aiBaseUrl}
                onChange={(e) => setAiBaseUrl(e.target.value)}
                placeholder={
                  aiProvider === "ollama"
                    ? "http://127.0.0.1:11434"
                    : "https://api.openai.com"
                }
                disabled={!engineReady || busy}
              />
            </label>
          )}
          <label className="block">
            <span className="mb-1 block text-muted-foreground">Model</span>
            <input
              className={inputClass}
              value={aiModel}
              onChange={(e) => setAiModel(e.target.value)}
              placeholder={
                aiProvider === "ollama"
                  ? "llama3.1:latest"
                  : aiProvider === "openai"
                    ? "gpt-4o-mini"
                    : "claude-sonnet-4-20250514"
              }
              disabled={!engineReady || busy}
            />
            {aiProvider === "ollama" && (
              <span className="mt-1 block text-xs text-muted-foreground">
                Must match a name from <span className="font-mono">ollama list</span>.
              </span>
            )}
          </label>
          {aiNeedsKey && (
            <label className="block">
              <span className="mb-1 block text-muted-foreground">
                API key{aiItem ? " (leave blank to keep current)" : ""}
              </span>
              <input
                className={inputClass}
                type="password"
                autoComplete="off"
                value={aiApiKey}
                onChange={(e) => setAiApiKey(e.target.value)}
                placeholder={aiItem ? "••••" : "sk-…"}
                disabled={!engineReady || busy}
              />
            </label>
          )}
        </section>

        {/* Behavior */}
        <section className="space-y-2 rounded-md border border-border p-3">
          <p className="font-semibold">Behavior</p>
          <label className="flex items-start gap-2">
            <input
              type="checkbox"
              className="mt-1"
              checked={aiUseOtherBuilds}
              disabled={!engineReady || busy}
              onChange={(e) => setAiUseOtherBuilds(e.target.checked)}
            />
            <span>
              <span className="font-medium text-foreground">Use my other builds as examples</span>
              <span className="mt-0.5 block text-xs text-muted-foreground">
                Few-shot context from other plans (not model training). Respects tenant isolation.
              </span>
            </span>
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={aiEnabled}
              disabled={!engineReady || busy}
              onChange={(e) => setAiEnabled(e.target.checked)}
            />
            Enabled
          </label>
          <label className="block">
            <span className="mb-1 block text-muted-foreground">Max tokens (completion)</span>
            <input
              className={inputClass}
              type="number"
              min={1}
              inputMode="numeric"
              value={aiMaxTokens}
              onChange={(e) => setAiMaxTokens(e.target.value)}
              disabled={!engineReady || busy}
            />
          </label>
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1 block text-muted-foreground">Daily request budget</span>
              <input
                className={inputClass}
                type="number"
                min={0}
                inputMode="numeric"
                value={aiDailyRequestBudget}
                onChange={(e) => setAiDailyRequestBudget(e.target.value)}
                placeholder="Unlimited"
                disabled={!engineReady || busy}
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-muted-foreground">Daily token budget</span>
              <input
                className={inputClass}
                type="number"
                min={0}
                inputMode="numeric"
                value={aiDailyTokenBudget}
                onChange={(e) => setAiDailyTokenBudget(e.target.value)}
                placeholder="Unlimited"
                disabled={!engineReady || busy}
              />
            </label>
          </div>
          <p className="text-xs text-muted-foreground">
            Soft per-tenant caps for chat (UTC day). Leave blank for unlimited / env defaults.
          </p>
        </section>

        {/* Web search */}
        <section className="space-y-2 rounded-md border border-border p-3">
          <p className="font-semibold">Web search</p>
          <label className="block">
            <span className="mb-1 block text-muted-foreground">Search provider</span>
            <Select
              value={searchProvider}
              onValueChange={(v) => setSearchProvider(v as SearchProviderChoice)}
              disabled={!engineReady || busy}
            >
              <SelectTrigger className="min-h-10 w-full max-w-none sm:max-w-md">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="auto">Auto (env / provider-native)</SelectItem>
                <SelectItem value="duckduckgo">DuckDuckGo (HTML)</SelectItem>
                <SelectItem value="brave">Brave Search</SelectItem>
                <SelectItem value="exa">Exa</SelectItem>
                <SelectItem value="none">Disabled</SelectItem>
              </SelectContent>
            </Select>
          </label>
          {searchNeedsKey && (
            <label className="block">
              <span className="mb-1 block text-muted-foreground">
                Search API key{aiItem ? " (leave blank to keep / use env)" : " (optional if env set)"}
              </span>
              <input
                className={inputClass}
                type="password"
                autoComplete="off"
                value={searchApiKey}
                onChange={(e) => setSearchApiKey(e.target.value)}
                placeholder={aiItem ? "••••" : "API key"}
                disabled={!engineReady || busy}
              />
            </label>
          )}
          {(aiProvider === "anthropic" || aiProvider === "openai") && searchProvider === "auto" && (
            <p className="text-xs text-muted-foreground">
              With Auto, status may show {aiProvider}-native; structured{" "}
              <span className="font-mono">web_search</span> hits still use DuckDuckGo unless you
              pick Brave or Exa.
            </p>
          )}
          {assistantStatus?.search?.options && (
            <ul className="space-y-1 text-xs text-muted-foreground">
              {assistantStatus.search.options
                .filter((o) => o.id !== "none")
                .map((o) => (
                  <li key={o.id}>
                    <span className="font-medium text-foreground">{o.label}</span>
                    {" — "}
                    {o.setup}
                  </li>
                ))}
            </ul>
          )}
        </section>

        {/* URL research */}
        <section className="space-y-2 rounded-md border border-border p-3">
          <p className="font-semibold">URL research</p>
          <label className="flex items-start gap-2">
            <input
              type="checkbox"
              className="mt-1"
              checked={allowUrlIngest}
              disabled={!engineReady || busy}
              onChange={(e) => setAllowUrlIngest(e.target.checked)}
            />
            <span>
              <span className="font-medium text-foreground">
                Allow product / guide URL fetch
              </span>
              <span className="mt-0.5 block text-xs text-muted-foreground">
                Enables <span className="font-mono">ingest_guide_url</span> and{" "}
                <span className="font-mono">fetch_web_page</span> (SSRF-guarded).
              </span>
            </span>
          </label>
          <label className="block">
            <span className="mb-1 block text-muted-foreground">Max download size (KB)</span>
            <input
              className={inputClass}
              type="number"
              min={1}
              inputMode="numeric"
              value={guideMaxKb}
              onChange={(e) => setGuideMaxKb(e.target.value)}
              disabled={!engineReady || busy}
            />
          </label>
        </section>

        {/* Advanced Ollama */}
        {aiProvider === "ollama" && (
          <section className="space-y-2 rounded-md border border-border p-3">
            <p className="font-semibold">Advanced (Ollama)</p>
            <label className="block">
              <span className="mb-1 block text-muted-foreground">
                Context window (<span className="font-mono">num_ctx</span>)
              </span>
              <input
                className={inputClass}
                type="number"
                min={2048}
                step={1024}
                inputMode="numeric"
                value={ollamaNumCtx}
                onChange={(e) => setOllamaNumCtx(e.target.value)}
                disabled={!engineReady || busy}
              />
              <span className="mt-1 block text-xs text-muted-foreground">
                Minimum 2048. Default {DEFAULT_OLLAMA_CTX}. Larger values need more VRAM.
              </span>
            </label>
          </section>
        )}

        <div className="flex flex-wrap items-center gap-2">
          {!aiItem ? (
            <Button
              className="min-h-10"
              disabled={!engineReady || busy || !canCreate}
              onClick={() => void onAdd()}
            >
              Add AI assistant
            </Button>
          ) : (
            <>
              <Button
                className="min-h-10"
                disabled={!engineReady || busy || !aiModel.trim()}
                onClick={() => void onSave()}
              >
                Save
              </Button>
              <Button
                variant="secondary"
                className="min-h-10"
                disabled={!engineReady || testing}
                onClick={() => void onTest()}
              >
                {testing ? "Testing…" : "Test connection"}
              </Button>
              <Button
                variant="destructive"
                className="min-h-10"
                disabled={busy}
                onClick={() => void onDelete()}
              >
                Delete
              </Button>
            </>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
