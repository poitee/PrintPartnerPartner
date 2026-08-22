import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchProfiles } from "./engine";

describe("engine GET cache", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("does not reuse GET /plans from the HTTP cache after creating a Build", async () => {
    const fetchMock = vi.fn(async () => {
      return new Response(JSON.stringify({ profiles: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    await fetchProfiles();

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringMatching(/\/plans$/),
      expect.objectContaining({ cache: "no-store" }),
    );
  });
});
