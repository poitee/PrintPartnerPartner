import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronDown } from "lucide-react";
import {
  createIntegration,
  deleteIntegration,
  fetchAssistantStatus,
  fetchIntegrations,
  fetchSpoolmanDefaultSettings,
  saveSpoolmanDefaultIntegration,
  testIntegration,
  updateIntegration,
  type IntegrationSummary,
} from "../../api/engine";
import type { AssistantStatus } from "@print-partner/contracts";
import { Button } from "../ui/button";
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

const NONE = "__none__";

type AiProviderChoice = "ollama" | "openai" | "anthropic";

export default function IntegrationsSettingsCard({ engineReady }: Props) {
  const [items, setItems] = useState<IntegrationSummary[]>([]);
  const [defaultId, setDefaultId] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [testingId, setTestingId] = useState<string | null>(null);

  const [newName, setNewName] = useState("");
  const [newUrl, setNewUrl] = useState("http://192.168.1.50:7912");

  const [aiName, setAiName] = useState("Kit advisor");
  const [aiProvider, setAiProvider] = useState<AiProviderChoice>("ollama");
  const [aiBaseUrl, setAiBaseUrl] = useState("http://127.0.0.1:11434");
  const [aiModel, setAiModel] = useState("llama3.1");
  const [aiApiKey, setAiApiKey] = useState("");
  /** Few-shot examples from other plans — not model training. Default on. */
  const [aiUseOtherBuilds, setAiUseOtherBuilds] = useState(true);
  /** Soft daily caps; empty = use env / unlimited. */
  const [aiDailyRequestBudget, setAiDailyRequestBudget] = useState("");
  const [aiDailyTokenBudget, setAiDailyTokenBudget] = useState("");
  const [assistantStatus, setAssistantStatus] = useState<AssistantStatus | null>(null);

  const spoolmanItems = useMemo(
    () => items.filter((i) => i.type === "spoolman"),
    [items],
  );
  const aiItems = useMemo(
    () => items.filter((i) => i.type === "ai_assistant"),
    [items],
  );

  const refresh = useCallback(async () => {
    if (!engineReady) return;
    setLoadError(null);
    try {
      const [integrations, defaults, status] = await Promise.all([
        fetchIntegrations(),
        fetchSpoolmanDefaultSettings(),
        fetchAssistantStatus().catch(() => null),
      ]);
      setItems(integrations);
      setDefaultId(defaults.integration_id);
      setAssistantStatus(status);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
    }
  }, [engineReady]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const item = aiItems[0];
    if (!item) return;
    setAiName(item.name);
    setAiProvider((item.config.provider as AiProviderChoice) || "ollama");
    setAiModel(String(item.config.model ?? ""));
    setAiBaseUrl(
      String(
        item.config.base_url ?? item.config.ollama_url ?? item.config.baseUrl ?? "",
      ) || "http://127.0.0.1:11434",
    );
    setAiApiKey("");
    setAiUseOtherBuilds(item.config.use_other_builds_as_examples !== false);
    const reqBudget = item.config.daily_request_budget ?? item.config.dailyRequestBudget;
    const tokBudget = item.config.daily_token_budget ?? item.config.dailyTokenBudget;
    setAiDailyRequestBudget(
      typeof reqBudget === "number" && reqBudget > 0 ? String(reqBudget) : "",
    );
    setAiDailyTokenBudget(
      typeof tokBudget === "number" && tokBudget > 0 ? String(tokBudget) : "",
    );
  }, [aiItems]);

  useEffect(() => {
    if (aiItems.length > 0) return;
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
  }, [aiProvider, aiItems.length]);

  const onAddSpoolman = async () => {
    const name = newName.trim();
    const base_url = newUrl.trim();
    if (!name || !base_url) return;
    setBusy(true);
    setMessage(null);
    setLoadError(null);
    try {
      const created = await createIntegration({
        type: "spoolman",
        name,
        config: { base_url, enabled: true },
      });
      setNewName("");
      if (!defaultId) {
        const saved = await saveSpoolmanDefaultIntegration(created.id);
        setDefaultId(saved.integration_id);
        setMessage(
          "Spoolman added and enabled for the Build filament picker. Pick a Spoolman color on Build, then update build.",
        );
      } else {
        setMessage(
          "Spoolman integration added. Select it under Use for filament picker if you want it on Build.",
        );
      }
      await refresh();
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const onAddAi = async () => {
    const name = aiName.trim();
    const model = aiModel.trim();
    if (!name || !model) return;
    if ((aiProvider === "openai" || aiProvider === "anthropic") && !aiApiKey.trim()) return;
    setBusy(true);
    setMessage(null);
    setLoadError(null);
    try {
      const config: Record<string, unknown> = {
        provider: aiProvider,
        model,
        enabled: true,
        use_other_builds_as_examples: aiUseOtherBuilds,
      };
      if (aiProvider === "ollama" || aiProvider === "openai") {
        config.base_url = aiBaseUrl.trim() || (aiProvider === "ollama"
          ? "http://127.0.0.1:11434"
          : "https://api.openai.com");
      }
      if (aiProvider === "openai" || aiProvider === "anthropic") {
        config.api_key = aiApiKey.trim();
      }
      const reqBudget = Number(aiDailyRequestBudget);
      if (Number.isFinite(reqBudget) && reqBudget > 0) {
        config.daily_request_budget = Math.trunc(reqBudget);
      }
      const tokBudget = Number(aiDailyTokenBudget);
      if (Number.isFinite(tokBudget) && tokBudget > 0) {
        config.daily_token_budget = Math.trunc(tokBudget);
      }
      await createIntegration({
        type: "ai_assistant",
        name,
        config,
      });
      setAiApiKey("");
      setMessage(
        "AI assistant saved. The kit advisor uses these Settings (env vars are a fallback for operators).",
      );
      await refresh();
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const onTest = async (id: string) => {
    setTestingId(id);
    setMessage(null);
    setLoadError(null);
    try {
      const result = await testIntegration(id);
      setMessage(result.ok ? result.message ?? "Connected." : result.message ?? "Test failed.");
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
    } finally {
      setTestingId(null);
    }
  };

  const onDelete = async (id: string) => {
    setBusy(true);
    setLoadError(null);
    try {
      await deleteIntegration(id);
      if (defaultId === id) {
        await saveSpoolmanDefaultIntegration(null);
        setDefaultId(null);
      }
      setMessage("Integration removed.");
      await refresh();
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const onDefaultChange = async (value: string) => {
    const next = value === NONE ? null : value;
    setDefaultId(next);
    setLoadError(null);
    try {
      const saved = await saveSpoolmanDefaultIntegration(next);
      setDefaultId(saved.integration_id);
      setMessage(
        next
          ? "Spoolman integration enabled for the Build filament picker."
          : "Spoolman picker disabled.",
      );
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
      await refresh();
    }
  };

  const onToggleEnabled = async (item: IntegrationSummary, enabled: boolean) => {
    setBusy(true);
    setLoadError(null);
    try {
      await updateIntegration(item.id, { config: { enabled } });
      await refresh();
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const onSaveAiEdits = async (item: IntegrationSummary) => {
    const model = aiModel.trim();
    if (!model) return;
    const provider = String(item.config.provider ?? aiProvider) as AiProviderChoice;
    setBusy(true);
    setMessage(null);
    setLoadError(null);
    try {
      const config: Record<string, unknown> = {
        model,
        use_other_builds_as_examples: aiUseOtherBuilds,
      };
      if (provider === "ollama" || provider === "openai") {
        config.base_url = aiBaseUrl.trim() || (provider === "ollama"
          ? "http://127.0.0.1:11434"
          : "https://api.openai.com");
      }
      if ((provider === "openai" || provider === "anthropic") && aiApiKey.trim()) {
        config.api_key = aiApiKey.trim();
      }
      const reqBudget = Number(aiDailyRequestBudget);
      config.daily_request_budget =
        Number.isFinite(reqBudget) && reqBudget > 0 ? Math.trunc(reqBudget) : null;
      const tokBudget = Number(aiDailyTokenBudget);
      config.daily_token_budget =
        Number.isFinite(tokBudget) && tokBudget > 0 ? Math.trunc(tokBudget) : null;
      await updateIntegration(item.id, { name: aiName.trim() || item.name, config });
      setAiApiKey("");
      setMessage("AI assistant updated.");
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
  const aiCanAdd =
    Boolean(aiName.trim() && aiModel.trim()) && (!aiNeedsKey || Boolean(aiApiKey.trim()));

  return (
    <details className="group rounded-lg border border-border bg-card shadow-none">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-4 py-3 [&::-webkit-details-marker]:hidden">
        <div className="min-w-0">
          <p className="text-base font-semibold">Optional integrations</p>
          <p className="text-sm text-muted-foreground">
            Spoolman filament inventory and the kit AI advisor (Ollama / OpenAI / Anthropic).
          </p>
        </div>
        <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
      </summary>
      <div className="border-t border-border px-4 pb-4 pt-3 space-y-6">
        {loadError && <p className="text-sm text-destructive">{loadError}</p>}
        {message && <p className="text-sm text-muted-foreground">{message}</p>}

        <div className="space-y-3">
          <p className="text-sm font-semibold">AI assistant</p>
          <p className="text-sm text-muted-foreground">
            Recommended for self-host: point at a local{" "}
            <span className="font-medium text-foreground">Ollama</span> instance. Cloud API keys
            stay on the server and are never shown after save.
          </p>
          {aiProvider === "ollama" && (
            <p className="text-xs text-muted-foreground">
              Docker Compose: use{" "}
              <span className="font-mono text-foreground">http://host.docker.internal:11434</span>
              {" "}(not 127.0.0.1 — that is the container). On the host, run Ollama with{" "}
              <span className="font-mono text-foreground">OLLAMA_HOST=0.0.0.0</span> so Docker can
              reach it. Native (non-Docker) installs can keep{" "}
              <span className="font-mono text-foreground">http://127.0.0.1:11434</span>.
            </p>
          )}

          {aiItems.length === 0 ? (
            <div className="space-y-2 rounded-md border border-border p-3">
              <p className="text-sm font-medium">Add AI assistant</p>
              <label className="block text-sm">
                <span className="mb-1 block text-muted-foreground">Name</span>
                <input
                  className={inputClass}
                  value={aiName}
                  onChange={(e) => setAiName(e.target.value)}
                  placeholder="Kit advisor"
                  disabled={!engineReady || busy}
                />
              </label>
              <label className="block text-sm">
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
              {(aiProvider === "ollama" || aiProvider === "openai") && (
                <label className="block text-sm">
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
                  {aiProvider === "ollama" && (
                    <span className="mt-1 block text-xs text-muted-foreground">
                      Placeholder is for native installs. In Docker, set{" "}
                      <span className="font-mono">http://host.docker.internal:11434</span>.
                    </span>
                  )}
                </label>
              )}
              <label className="block text-sm">
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
                    Must match a name from{" "}
                    <span className="font-mono">ollama list</span> on the host (e.g.{" "}
                    <span className="font-mono">llama3.1:latest</span>). Test connection
                    checks that the model is installed.
                  </span>
                )}
              </label>
              {aiNeedsKey && (
                <label className="block text-sm">
                  <span className="mb-1 block text-muted-foreground">API key</span>
                  <input
                    className={inputClass}
                    type="password"
                    autoComplete="off"
                    value={aiApiKey}
                    onChange={(e) => setAiApiKey(e.target.value)}
                    placeholder="sk-…"
                    disabled={!engineReady || busy}
                  />
                </label>
              )}
              <label className="flex items-start gap-2 text-sm">
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
                    Sends compact summaries of your other plans as few-shot context (not model
                    training). Respects plan access / tenant isolation.
                  </span>
                </span>
              </label>
              <div className="grid gap-2 sm:grid-cols-2">
                <label className="block text-sm">
                  <span className="mb-1 block text-muted-foreground">
                    Daily request budget (optional)
                  </span>
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
                <label className="block text-sm">
                  <span className="mb-1 block text-muted-foreground">
                    Daily token budget (optional)
                  </span>
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
                Soft per-tenant caps for `/assistant/chat` (UTC day). Leave blank for unlimited /
                env defaults. See DEPLOY.md.
              </p>
              {assistantStatus?.search && (
                <div className="space-y-1.5 rounded-md border border-border bg-muted/30 p-2.5">
                  <p className="text-sm font-medium">
                    Web search:{" "}
                    <span className="font-mono text-foreground">
                      {assistantStatus.search.provider}
                    </span>
                    {!assistantStatus.search.configured && (
                      <span className="ml-1 text-amber-700 dark:text-amber-400">
                        (not configured)
                      </span>
                    )}
                  </p>
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
                </div>
              )}
              <Button
                className="min-h-10"
                disabled={!engineReady || busy || !aiCanAdd}
                onClick={() => void onAddAi()}
              >
                Add AI assistant
              </Button>
            </div>
          ) : (
            aiItems.slice(0, 1).map((item) => {
              const provider = String(item.config.provider ?? "none") as AiProviderChoice;
              const enabled = item.config.enabled !== false;
              const needsKey = provider === "openai" || provider === "anthropic";
              return (
                <div key={item.id} className="space-y-2 rounded-md border border-border p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm font-medium">Edit AI assistant</p>
                    <p className="font-mono text-xs text-muted-foreground">{provider}</p>
                  </div>
                  <label className="block text-sm">
                    <span className="mb-1 block text-muted-foreground">Name</span>
                    <input
                      className={inputClass}
                      value={aiName}
                      onChange={(e) => setAiName(e.target.value)}
                      disabled={!engineReady || busy}
                    />
                  </label>
                  {(provider === "ollama" || provider === "openai") && (
                    <label className="block text-sm">
                      <span className="mb-1 block text-muted-foreground">
                        {provider === "ollama" ? "Ollama URL" : "Base URL"}
                      </span>
                      <input
                        className={inputClass}
                        value={aiBaseUrl}
                        onChange={(e) => setAiBaseUrl(e.target.value)}
                        disabled={!engineReady || busy}
                      />
                      {provider === "ollama" && (
                        <span className="mt-1 block text-xs text-muted-foreground">
                          Docker:{" "}
                          <span className="font-mono">http://host.docker.internal:11434</span>
                          {" "}+ host{" "}
                          <span className="font-mono">OLLAMA_HOST=0.0.0.0</span>. See DEPLOY.md.
                        </span>
                      )}
                    </label>
                  )}
                  <label className="block text-sm">
                    <span className="mb-1 block text-muted-foreground">Model</span>
                    <input
                      className={inputClass}
                      value={aiModel}
                      onChange={(e) => setAiModel(e.target.value)}
                      disabled={!engineReady || busy}
                    />
                    {provider === "ollama" && (
                      <span className="mt-1 block text-xs text-muted-foreground">
                        Must match{" "}
                        <span className="font-mono">ollama list</span> (e.g.{" "}
                        <span className="font-mono">llama3.1:latest</span>).
                      </span>
                    )}
                  </label>
                  {needsKey && (
                    <label className="block text-sm">
                      <span className="mb-1 block text-muted-foreground">
                        API key (leave blank to keep current)
                      </span>
                      <input
                        className={inputClass}
                        type="password"
                        autoComplete="off"
                        value={aiApiKey}
                        onChange={(e) => setAiApiKey(e.target.value)}
                        placeholder="••••"
                        disabled={!engineReady || busy}
                      />
                    </label>
                  )}
                  <div className="grid gap-2 sm:grid-cols-2">
                    <label className="block text-sm">
                      <span className="mb-1 block text-muted-foreground">
                        Daily request budget
                      </span>
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
                    <label className="block text-sm">
                      <span className="mb-1 block text-muted-foreground">
                        Daily token budget
                      </span>
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
                  {assistantStatus?.search && (
                    <div className="space-y-1.5 rounded-md border border-border bg-muted/30 p-2.5">
                      <p className="text-sm font-medium">
                        Web search:{" "}
                        <span className="font-mono text-foreground">
                          {assistantStatus.search.provider}
                        </span>
                        {!assistantStatus.search.configured && (
                          <span className="ml-1 text-amber-700 dark:text-amber-400">
                            (not configured)
                          </span>
                        )}
                      </p>
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
                    </div>
                  )}
                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={enabled}
                        disabled={busy}
                        onChange={(e) => void onToggleEnabled(item, e.target.checked)}
                      />
                      Enabled
                    </label>
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={aiUseOtherBuilds}
                        disabled={busy}
                        onChange={(e) => setAiUseOtherBuilds(e.target.checked)}
                      />
                      Use other builds as examples
                    </label>
                    <Button
                      size="sm"
                      disabled={!engineReady || busy || !aiModel.trim()}
                      onClick={() => void onSaveAiEdits(item)}
                    >
                      Save
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={!engineReady || testingId === item.id}
                      onClick={() => void onTest(item.id)}
                    >
                      {testingId === item.id ? "Testing…" : "Test connection"}
                    </Button>
                    <Button
                      variant="destructive"
                      size="sm"
                      disabled={busy}
                      onClick={() => void onDelete(item.id)}
                    >
                      Delete
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    To switch provider, delete and add a new AI assistant. Extra AI integrations
                    are ignored (most recently updated wins).
                  </p>
                </div>
              );
            })
          )}
        </div>

        <div className="space-y-4 border-t border-border pt-4">
          <p className="text-sm font-semibold">Spoolman</p>
          <div className="space-y-2 rounded-md border border-border p-3">
            <p className="text-sm font-medium">Add Spoolman</p>
            <label className="block text-sm">
              <span className="mb-1 block text-muted-foreground">Name</span>
              <input
                className={inputClass}
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Workshop Spoolman"
                disabled={!engineReady || busy}
              />
            </label>
            <label className="block text-sm">
              <span className="mb-1 block text-muted-foreground">Base URL (no /api/v1)</span>
              <input
                className={inputClass}
                value={newUrl}
                onChange={(e) => setNewUrl(e.target.value)}
                placeholder="http://192.168.1.50:7912"
                disabled={!engineReady || busy}
              />
            </label>
            <Button
              className="min-h-10"
              disabled={!engineReady || busy || !newName.trim() || !newUrl.trim()}
              onClick={() => void onAddSpoolman()}
            >
              Add Spoolman
            </Button>
          </div>

          {spoolmanItems.length > 0 && !defaultId && (
            <p className="text-sm text-amber-700 dark:text-amber-400">
              Choose an integration under Use for filament picker so Spoolman filaments appear on
              Build. After picking a Spoolman filament, choose a physical spool when multiple are
              in stock; remaining weight appears in Review.
            </p>
          )}

          {spoolmanItems.length > 0 && (
            <label className="block text-sm">
              <span className="mb-1 block text-muted-foreground">Use for filament picker</span>
              <Select
                value={defaultId ?? NONE}
                onValueChange={(v) => void onDefaultChange(v)}
                disabled={!engineReady || busy}
              >
                <SelectTrigger className="min-h-10 w-full max-w-none sm:max-w-md">
                  <SelectValue placeholder="None" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>None</SelectItem>
                  {spoolmanItems.map((item) => (
                    <SelectItem key={item.id} value={item.id}>
                      {item.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
          )}

          <ul className="space-y-2">
            {spoolmanItems.map((item) => {
              const baseUrl = String(item.config.base_url ?? item.config.baseUrl ?? "");
              const enabled = item.config.enabled !== false;
              return (
                <li
                  key={item.id}
                  className="flex flex-col gap-2 rounded-md border border-border px-3 py-2.5 sm:flex-row sm:flex-wrap sm:items-center"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">{item.name}</p>
                    <p className="truncate font-mono text-xs text-muted-foreground">{baseUrl}</p>
                  </div>
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={enabled}
                      disabled={busy}
                      onChange={(e) => void onToggleEnabled(item, e.target.checked)}
                    />
                    Enabled
                  </label>
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={!engineReady || testingId === item.id}
                    onClick={() => void onTest(item.id)}
                  >
                    {testingId === item.id ? "Testing…" : "Test connection"}
                  </Button>
                  <Button
                    variant="destructive"
                    size="sm"
                    disabled={busy}
                    onClick={() => void onDelete(item.id)}
                  >
                    Delete
                  </Button>
                </li>
              );
            })}
          </ul>

          {!spoolmanItems.length && engineReady && (
            <p className="text-sm text-muted-foreground">No Spoolman integrations configured yet.</p>
          )}
        </div>
      </div>
    </details>
  );
}
