import { describe, expect, it } from "vitest";
import {
  getSearchSetupGuidance,
  resolveSearchProvider,
  searchConfigured,
  type ResolveSearchInput,
} from "./index.js";
import { parseDuckDuckGoHtml } from "./duckduckgo.js";

function baseInput(over: Partial<ResolveSearchInput> = {}): ResolveSearchInput {
  return {
    searchProvider: null,
    searchApiKey: null,
    aiProvider: "none",
    anthropicApiKey: null,
    openaiApiKey: null,
    ...over,
  };
}

describe("resolveSearchProvider", () => {
  it("uses explicit SEARCH_PROVIDER when set", () => {
    expect(
      resolveSearchProvider(baseInput({ searchProvider: "brave", searchApiKey: "k" })),
    ).toBe("brave");
    expect(resolveSearchProvider(baseInput({ searchProvider: "exa" }))).toBe("exa");
    expect(resolveSearchProvider(baseInput({ searchProvider: "duckduckgo" }))).toBe(
      "duckduckgo",
    );
    expect(resolveSearchProvider(baseInput({ searchProvider: "none" }))).toBe("none");
  });

  it("prefers anthropic-native when AI is anthropic with a key", () => {
    expect(
      resolveSearchProvider(
        baseInput({ aiProvider: "anthropic", anthropicApiKey: "sk-ant" }),
      ),
    ).toBe("anthropic-native");
  });

  it("prefers openai-native when AI is openai with a key", () => {
    expect(
      resolveSearchProvider(baseInput({ aiProvider: "openai", openaiApiKey: "sk-oai" })),
    ).toBe("openai-native");
  });

  it("falls back to duckduckgo when no native credentials", () => {
    expect(resolveSearchProvider(baseInput({ aiProvider: "anthropic" }))).toBe(
      "duckduckgo",
    );
    expect(resolveSearchProvider(baseInput({ aiProvider: "ollama" }))).toBe("duckduckgo");
    expect(resolveSearchProvider(baseInput())).toBe("duckduckgo");
  });

  it("explicit provider wins over native", () => {
    expect(
      resolveSearchProvider(
        baseInput({
          searchProvider: "duckduckgo",
          aiProvider: "anthropic",
          anthropicApiKey: "sk",
        }),
      ),
    ).toBe("duckduckgo");
  });
});

describe("searchConfigured", () => {
  it("requires API key for brave and exa", () => {
    expect(
      searchConfigured("brave", baseInput({ searchProvider: "brave" })),
    ).toBe(false);
    expect(
      searchConfigured("brave", baseInput({ searchProvider: "brave", searchApiKey: "k" })),
    ).toBe(true);
    expect(searchConfigured("exa", baseInput({ searchProvider: "exa" }))).toBe(false);
    expect(
      searchConfigured("exa", baseInput({ searchProvider: "exa", searchApiKey: "k" })),
    ).toBe(true);
  });

  it("duckduckgo is always configured; none is not", () => {
    expect(searchConfigured("duckduckgo", baseInput())).toBe(true);
    expect(searchConfigured("none", baseInput({ searchProvider: "none" }))).toBe(false);
  });
});

describe("getSearchSetupGuidance", () => {
  it("lists all backends", () => {
    const ids = getSearchSetupGuidance().map((o) => o.id);
    expect(ids).toContain("brave");
    expect(ids).toContain("exa");
    expect(ids).toContain("duckduckgo");
    expect(ids).toContain("anthropic-native");
  });
});

describe("parseDuckDuckGoHtml", () => {
  it("extracts result__a links and snippets", () => {
    const html = `
      <div class="result">
        <a class="result__a" href="https://example.com/kit">Example Kit</a>
        <a class="result__snippet">A great kit guide</a>
      </div>
      <div class="result">
        <a class="result__a" href="https://github.com/org/repo">GitHub Repo</a>
        <a class="result__snippet">README for the repo</a>
      </div>
    `;
    const hits = parseDuckDuckGoHtml(html, 5);
    expect(hits).toHaveLength(2);
    expect(hits[0]).toMatchObject({
      title: "Example Kit",
      url: "https://example.com/kit",
    });
    expect(hits[0]!.snippet).toMatch(/great kit/i);
  });
});
