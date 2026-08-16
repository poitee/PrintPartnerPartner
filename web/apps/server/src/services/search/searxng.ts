/**
 * SearXNG search backend — self-hosted, no API key required.
 * Targets the JSON output endpoint at `<baseUrl>/search?format=json`.
 *
 * Default base URL: http://localhost:4040 (SEARXNG_URL env or config.searxngUrl).
 */

import { OutboundUrlError, safeOutboundFetch } from "../../lib/outbound-url.js";
import type { SearchHit, WebSearchOptions } from "./types.js";

export const DEFAULT_SEARXNG_URL = "http://localhost:4040";

/** SearXNG JSON result shape (only the fields we use). */
type SearXNGResult = {
  title?: string;
  url?: string;
  content?: string;
};

type SearXNGResponse = {
  results?: SearXNGResult[];
  error?: string;
};

export async function searchSearXNG(
  options: WebSearchOptions,
  baseUrl: string = DEFAULT_SEARXNG_URL,
  fetchFn: typeof safeOutboundFetch = safeOutboundFetch,
): Promise<{ hits: SearchHit[]; error?: string }> {
  const q = options.site ? `site:${options.site} ${options.query}` : options.query;
  const count = Math.min(Math.max(options.maxResults ?? 5, 1), 20);

  const origin = baseUrl.replace(/\/$/, "");
  const url = `${origin}/search?q=${encodeURIComponent(q)}&format=json&pageno=1`;

  try {
    const res = await fetchFn(url, {
      headers: {
        Accept: "application/json",
        "User-Agent": "PrintPartner-Search/1.0",
      },
    });

    if (!res.ok) {
      return { hits: [], error: `SearXNG HTTP ${res.status}` };
    }

    const body = (await res.json()) as SearXNGResponse;

    if (body.error) {
      return { hits: [], error: `SearXNG error: ${body.error}` };
    }

    const hits: SearchHit[] = (body.results ?? [])
      .filter((r): r is SearXNGResult & { url: string } => Boolean(r.url))
      .slice(0, count)
      .map((r) => ({
        title: String(r.title || r.url),
        url: String(r.url),
        snippet: String(r.content ?? "").slice(0, 500),
      }));

    return { hits };
  } catch (err) {
    const msg =
      err instanceof OutboundUrlError
        ? err.message
        : err instanceof Error
          ? err.message
          : String(err);
    return { hits: [], error: `SearXNG search failed: ${msg}` };
  }
}
