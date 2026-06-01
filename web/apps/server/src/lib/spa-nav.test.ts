import { describe, expect, it } from "vitest";
import { isBrowserDocumentNavigation, isSpaClientPath } from "./spa-nav.js";

describe("isSpaClientPath", () => {
  it("matches workflow routes", () => {
    expect(isSpaClientPath("/sources")).toBe(true);
    expect(isSpaClientPath("/build?profile=3")).toBe(true);
    expect(isSpaClientPath("/builds")).toBe(true);
    expect(isSpaClientPath("/plans/7/studio")).toBe(true);
  });

  it("ignores API-only paths", () => {
    expect(isSpaClientPath("/health")).toBe(false);
    expect(isSpaClientPath("/sources/1/cover")).toBe(false);
    expect(isSpaClientPath("/assets/app.js")).toBe(false);
  });
});

describe("isBrowserDocumentNavigation", () => {
  it("detects browser navigations", () => {
    expect(
      isBrowserDocumentNavigation({
        method: "GET",
        headers: { "sec-fetch-mode": "navigate", accept: "text/html" },
      } as never),
    ).toBe(true);
  });

  it("treats API fetches as non-document", () => {
    expect(
      isBrowserDocumentNavigation({
        method: "GET",
        headers: { "sec-fetch-mode": "cors", accept: "*/*" },
      } as never),
    ).toBe(false);
  });
});
