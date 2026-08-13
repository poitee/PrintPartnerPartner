import { afterEach, describe, expect, it, vi } from "vitest";
import { moonrakerAdapter } from "./moonraker.js";

describe("moonrakerAdapter", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("testConnection reports klippy state and sends API key headers", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ result: { klippy_state: "ready" } }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await moonrakerAdapter.testConnection({
      base_url: "http://127.0.0.1:7125",
      api_key: "test-api-key",
    });
    expect(result.ok).toBe(true);
    expect(result.message).toContain("klippy: ready");
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = new Headers(init.headers);
    expect(headers.get("X-Api-Key")).toBe("test-api-key");
    expect(headers.get("Authorization")).toBeNull();
  });

  it("getStatus maps print_stats and virtual_sdcard progress", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          result: {
            status: {
              print_stats: { state: "printing", filename: "frame_x.gcode" },
              virtual_sdcard: { progress: 0.42 },
            },
          },
        }),
      }),
    );

    const status = await moonrakerAdapter.getStatus!({
      base_url: "http://127.0.0.1:7125",
    });
    expect(status.state).toBe("printing");
    expect(status.progress).toBe(42);
    expect(status.filename).toBe("frame_x.gcode");
  });

  it("getStatus maps print_stats complete distinctly from idle", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          result: {
            status: {
              print_stats: { state: "complete", filename: "frame_x.gcode" },
              virtual_sdcard: { progress: 1 },
            },
          },
        }),
      }),
    );

    const status = await moonrakerAdapter.getStatus!({
      base_url: "http://127.0.0.1:7125",
    });
    expect(status.state).toBe("complete");
    expect(status.filename).toBe("frame_x.gcode");
  });

  it("getStatus maps cancelled to idle (no auto-checkoff)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          result: {
            status: {
              print_stats: { state: "cancelled", filename: "frame_x.gcode" },
            },
          },
        }),
      }),
    );

    const status = await moonrakerAdapter.getStatus!({
      base_url: "http://127.0.0.1:7125",
    });
    expect(status.state).toBe("idle");
  });

  it("uploadFile posts multipart then starts print when requested", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ result: { item: { path: "frame_x.gcode" } } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ result: "ok" }),
      });
    vi.stubGlobal("fetch", fetchMock);

    const result = await moonrakerAdapter.uploadFile!(
      { base_url: "http://127.0.0.1:7125" },
      new TextEncoder().encode("; gcode"),
      "frame_x.gcode",
      { start: true },
    );
    expect(result.ok).toBe(true);
    expect(result.started).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("/server/files/upload");
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain("/printer/print/start");
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain("frame_x.gcode");
  });

  it("uploadFile without start does not call print/start", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({}),
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await moonrakerAdapter.uploadFile!(
      { base_url: "http://127.0.0.1:7125" },
      new TextEncoder().encode("; gcode"),
      "only_upload.gcode",
      { start: false },
    );
    expect(result.ok).toBe(true);
    expect(result.started).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
