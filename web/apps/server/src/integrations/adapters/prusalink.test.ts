import { afterEach, describe, expect, it, vi } from "vitest";
import { prusalinkAdapter } from "./prusalink.js";

describe("prusalinkAdapter", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("requires password for testConnection", async () => {
    const result = await prusalinkAdapter.testConnection({
      base_url: "http://127.0.0.1",
      username: "maker",
    });
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/password/i);
  });

  it("testConnection follows Digest challenge then reads /info", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 401,
        headers: new Headers({
          "www-authenticate":
            'Digest realm="Printer API", nonce="abc", qop="auth", algorithm=MD5',
        }),
        json: async () => ({}),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: async () => ({ name: "Prusa MK4" }),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 401,
        headers: new Headers({
          "www-authenticate":
            'Digest realm="Printer API", nonce="abc", qop="auth", algorithm=MD5',
        }),
        json: async () => ({}),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: async () => ({ printer: { state: "IDLE" } }),
      });
    vi.stubGlobal("fetch", fetchMock);

    const result = await prusalinkAdapter.testConnection({
      base_url: "http://127.0.0.1",
      username: "maker",
      password: "printer-key",
    });
    expect(result.ok).toBe(true);
    expect(result.message).toContain("Prusa MK4");

    const authCall = fetchMock.mock.calls.find(
      (call) =>
        String(call[0]).includes("/api/v1/info") &&
        new Headers((call[1] as RequestInit | undefined)?.headers).has("Authorization"),
    );
    expect(authCall).toBeTruthy();
    const headers = new Headers((authCall![1] as RequestInit).headers);
    expect(headers.get("Authorization")).toMatch(/^Digest /);
  });

  it("uploadFile sends Print-After-Upload and Overwrite digest headers", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 401,
        headers: new Headers({
          "www-authenticate":
            'Digest realm="Printer API", nonce="n2", qop="auth", algorithm=MD5',
        }),
        text: async () => "",
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 201,
        headers: new Headers(),
        text: async () => "",
      });
    vi.stubGlobal("fetch", fetchMock);

    const result = await prusalinkAdapter.uploadFile!(
      {
        base_url: "http://127.0.0.1",
        username: "",
        password: "printer-key",
      },
      new TextEncoder().encode("; bgcode"),
      "part.bgcode",
      { start: true },
    );
    expect(result.ok).toBe(true);
    expect(result.started).toBe(true);

    const putAuthed = fetchMock.mock.calls.find(
      (call) =>
        (call[1] as RequestInit | undefined)?.method === "PUT" &&
        new Headers((call[1] as RequestInit).headers).has("Authorization"),
    );
    expect(putAuthed).toBeTruthy();
    const headers = new Headers((putAuthed![1] as RequestInit).headers);
    expect(headers.get("Print-After-Upload")).toBe("?1");
    expect(headers.get("Overwrite")).toBe("?1");
    expect(headers.get("Authorization")).toMatch(/^Digest /);
    expect(String(putAuthed![0])).toContain("/api/v1/files/usb/part.bgcode");
  });

  it("getStatus maps PRINTING progress", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 401,
        headers: new Headers({
          "www-authenticate":
            'Digest realm="Printer API", nonce="n3", qop="auth", algorithm=MD5',
        }),
        json: async () => ({}),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: async () => ({
          printer: { state: "PRINTING" },
          job: {
            progress: 33.3,
            file: { display_name: "benchy.bgcode" },
            time_remaining: 1200,
          },
        }),
      });
    vi.stubGlobal("fetch", fetchMock);

    const status = await prusalinkAdapter.getStatus!({
      base_url: "http://127.0.0.1",
      password: "printer-key",
    });
    expect(status.state).toBe("printing");
    expect(status.progress).toBe(33);
    expect(status.filename).toBe("benchy.bgcode");
    expect(status.eta_seconds).toBe(1200);
  });

  it("getStatus maps FINISHED to complete", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 401,
        headers: new Headers({
          "www-authenticate":
            'Digest realm="Printer API", nonce="n4", qop="auth", algorithm=MD5',
        }),
        json: async () => ({}),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: async () => ({
          printer: { state: "FINISHED" },
          job: { file: { name: "done.bgcode" }, progress: 100 },
        }),
      });
    vi.stubGlobal("fetch", fetchMock);

    const status = await prusalinkAdapter.getStatus!({
      base_url: "http://127.0.0.1",
      password: "printer-key",
    });
    expect(status.state).toBe("complete");
    expect(status.filename).toBe("done.bgcode");
  });
});
