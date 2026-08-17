import { beforeEach, describe, expect, it, vi } from "vitest";

const init = vi.fn();

vi.mock("@sentry/react", () => ({
  init: (...args: unknown[]) => init(...args),
}));

describe("initSentry", () => {
  beforeEach(() => {
    init.mockReset();
    vi.resetModules();
    vi.unstubAllEnvs();
  });

  it("does nothing when VITE_SENTRY_DSN is unset", async () => {
    vi.stubEnv("VITE_SENTRY_DSN", "");
    const { initSentry } = await import("./sentry");
    initSentry();
    expect(init).not.toHaveBeenCalled();
  });

  it("initializes with release when DSN is present", async () => {
    vi.stubEnv("VITE_SENTRY_DSN", "https://examplePublicKey@o0.ingest.sentry.io/0");
    vi.stubEnv("VITE_SENTRY_RELEASE", "3.1.0-web");
    const { initSentry } = await import("./sentry");
    initSentry();
    expect(init).toHaveBeenCalledWith(
      expect.objectContaining({
        dsn: "https://examplePublicKey@o0.ingest.sentry.io/0",
        release: "3.1.0-web",
        sendDefaultPii: false,
      }),
    );
  });
});
