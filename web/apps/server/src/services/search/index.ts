/**
 * Pluggable web search for assistant research tools.
 *
 * Resolution order (`resolveSearchProvider`):
 * 1. Explicit `SEARCH_PROVIDER` (config.searchProvider) when set and valid
 * 2. Provider-native when AI provider is anthropic/openai with a key
 * 3. DuckDuckGo HTML fallback (no key)
 * 4. `none` if somehow disabled
 *
 * HTTP backends for `web_search` tool hits: brave / exa / duckduckgo.
 * When the resolved provider is anthropic-native or openai-native, status reports
 * native, but the tool still returns DuckDuckGo hits so the tool loop always gets
 * structured results unless SEARCH_PROVIDER=brave|exa.
 */

import type { AiProviderId } from "@print-partner/contracts";
import type { ServerConfig } from "../../config.js";
import { safeOutboundFetch } from "../../lib/outbound-url.js";
import { searchBrave } from "./brave.js";
import { searchDuckDuckGo } from "./duckduckgo.js";
import { searchExa } from "./exa.js";
import { nativeSearchNote, nativeSearchProviderForAi } from "./provider-native.js";
import {
  isSearchProviderId,
  SEARCH_UNTRUSTED_BANNER,
  type SearchProviderId,
  type SearchSetupOption,
  type SearchStatus,
  type WebSearchOptions,
  type WebSearchResult,
} from "./types.js";

export type {
  SearchHit,
  SearchProviderId,
  SearchResult,
  SearchSetupOption,
  SearchStatus,
  WebSearchOptions,
  WebSearchResult,
} from "./types.js";
export { SEARCH_UNTRUSTED_BANNER, isSearchProviderId } from "./types.js";
export { parseDuckDuckGoHtml } from "./duckduckgo.js";
export { nativeSearchNote, nativeSearchProviderForAi } from "./provider-native.js";

export function getSearchSetupGuidance(): SearchSetupOption[] {
  return [
    {
      id: "anthropic-native",
      label: "Anthropic native",
      summary: "Zero extra search config when AI provider is Anthropic.",
      setup:
        "Set AI_PROVIDER=anthropic (or Settings → Anthropic) with ANTHROPIC_API_KEY. web_search still returns DuckDuckGo HTTP hits unless you set SEARCH_PROVIDER=brave|exa.",
    },
    {
      id: "openai-native",
      label: "OpenAI native",
      summary: "Zero extra search config when AI provider is OpenAI.",
      setup:
        "Set AI_PROVIDER=openai (or Settings → OpenAI) with OPENAI_API_KEY. web_search still returns DuckDuckGo HTTP hits unless you set SEARCH_PROVIDER=brave|exa.",
    },
    {
      id: "brave",
      label: "Brave Search",
      summary: "Official Brave Search API (recommended paid option).",
      setup: "SEARCH_PROVIDER=brave and SEARCH_API_KEY (or BRAVE_API_KEY) from https://brave.com/search/api/",
    },
    {
      id: "exa",
      label: "Exa",
      summary: "Exa neural search API.",
      setup: "SEARCH_PROVIDER=exa and SEARCH_API_KEY (or EXA_API_KEY) from https://exa.ai/",
    },
    {
      id: "duckduckgo",
      label: "DuckDuckGo (HTML)",
      summary: "No API key — brittle HTML scrape fallback.",
      setup: "Default when no API key. Force with SEARCH_PROVIDER=duckduckgo. Prefer Brave/Exa for reliability.",
    },
    {
      id: "none",
      label: "Disabled",
      summary: "Web search tools return setup hints only.",
      setup: "SEARCH_PROVIDER=none disables HTTP search.",
    },
  ];
}

export type ResolveSearchInput = {
  searchProvider: SearchProviderId | null;
  searchApiKey: string | null;
  aiProvider: AiProviderId;
  anthropicApiKey: string | null;
  openaiApiKey: string | null;
};

export function resolveSearchProvider(input: ResolveSearchInput): SearchProviderId {
  const explicit = input.searchProvider;
  if (explicit && isSearchProviderId(explicit)) {
    return explicit;
  }

  const native = nativeSearchProviderForAi(input.aiProvider);
  if (native === "anthropic-native" && input.anthropicApiKey) return "anthropic-native";
  if (native === "openai-native" && input.openaiApiKey) return "openai-native";

  return "duckduckgo";
}

export function searchConfigured(
  provider: SearchProviderId,
  input: ResolveSearchInput,
): boolean {
  if (provider === "none") return false;
  if (provider === "duckduckgo") return true;
  if (provider === "brave" || provider === "exa") return Boolean(input.searchApiKey);
  if (provider === "anthropic-native") return Boolean(input.anthropicApiKey);
  if (provider === "openai-native") return Boolean(input.openaiApiKey);
  return false;
}

export function getSearchStatus(config: ServerConfig, aiProvider?: AiProviderId): SearchStatus {
  const input: ResolveSearchInput = {
    searchProvider: config.searchProvider,
    searchApiKey: config.searchApiKey,
    aiProvider: aiProvider ?? config.aiProvider,
    anthropicApiKey: config.anthropicApiKey,
    openaiApiKey: config.openaiApiKey,
  };
  const provider = resolveSearchProvider(input);
  return {
    provider,
    configured: searchConfigured(provider, input),
    options: getSearchSetupGuidance(),
  };
}

function setupHintFor(provider: SearchProviderId, missingKey?: boolean): string {
  const options = getSearchSetupGuidance();
  if (provider === "brave" || provider === "exa") {
    const opt = options.find((o) => o.id === provider);
    return missingKey
      ? `Missing API key. ${opt?.setup ?? ""}`
      : (opt?.setup ?? "");
  }
  if (provider === "none") {
    return options.find((o) => o.id === "none")!.setup;
  }
  return (
    "Set SEARCH_PROVIDER=brave|exa with SEARCH_API_KEY for reliable results, or leave unset for DuckDuckGo HTML fallback."
  );
}

/**
 * Run web search via the active HTTP backend.
 * Native providers report as native but use DuckDuckGo for HTTP hits.
 */
export async function searchWeb(
  options: WebSearchOptions,
  config: ServerConfig,
  deps?: {
    aiProvider?: AiProviderId;
    fetchFn?: typeof safeOutboundFetch;
  },
): Promise<WebSearchResult> {
  const query = options.query.trim();
  if (!query) {
    return {
      provider: "none",
      hits: [],
      untrusted_banner: SEARCH_UNTRUSTED_BANNER,
      error: "query required",
      setup_hint: setupHintFor("duckduckgo"),
    };
  }

  const input: ResolveSearchInput = {
    searchProvider: config.searchProvider,
    searchApiKey: config.searchApiKey,
    aiProvider: deps?.aiProvider ?? config.aiProvider,
    anthropicApiKey: config.anthropicApiKey,
    openaiApiKey: config.openaiApiKey,
  };
  const provider = resolveSearchProvider(input);
  const fetchFn = deps?.fetchFn ?? safeOutboundFetch;

  if (provider === "none") {
    return {
      provider,
      hits: [],
      untrusted_banner: SEARCH_UNTRUSTED_BANNER,
      error: "Web search disabled (SEARCH_PROVIDER=none)",
      setup_hint: setupHintFor("none"),
    };
  }

  if (provider === "brave") {
    if (!input.searchApiKey) {
      return {
        provider,
        hits: [],
        untrusted_banner: SEARCH_UNTRUSTED_BANNER,
        error: "Brave Search requires SEARCH_API_KEY or BRAVE_API_KEY",
        setup_hint: setupHintFor("brave", true),
      };
    }
    const { hits, error } = await searchBrave(options, input.searchApiKey, fetchFn);
    return {
      provider,
      hits,
      untrusted_banner: SEARCH_UNTRUSTED_BANNER,
      http_backend: "brave",
      ...(error ? { error, setup_hint: setupHintFor("brave") } : {}),
    };
  }

  if (provider === "exa") {
    if (!input.searchApiKey) {
      return {
        provider,
        hits: [],
        untrusted_banner: SEARCH_UNTRUSTED_BANNER,
        error: "Exa Search requires SEARCH_API_KEY or EXA_API_KEY",
        setup_hint: setupHintFor("exa", true),
      };
    }
    const { hits, error } = await searchExa(options, input.searchApiKey, fetchFn);
    return {
      provider,
      hits,
      untrusted_banner: SEARCH_UNTRUSTED_BANNER,
      http_backend: "exa",
      ...(error ? { error, setup_hint: setupHintFor("exa") } : {}),
    };
  }

  // anthropic-native / openai-native / duckduckgo → DuckDuckGo HTTP
  const { hits, error } = await searchDuckDuckGo(options, fetchFn);
  const note =
    provider === "anthropic-native" || provider === "openai-native"
      ? nativeSearchNote(provider)
      : undefined;
  return {
    provider,
    hits,
    untrusted_banner: SEARCH_UNTRUSTED_BANNER,
    http_backend: "duckduckgo",
    ...(error
      ? { error, setup_hint: setupHintFor(provider) }
      : note
        ? { setup_hint: note }
        : {}),
  };
}
