import * as Sentry from "@sentry/react";

/**
 * Minimal browser Sentry init for official release builds.
 * No-op unless VITE_SENTRY_DSN is baked in at build time (never required for self-host).
 */
export function initSentry(): void {
  const dsn = import.meta.env.VITE_SENTRY_DSN?.trim();
  if (!dsn) return;

  const release = import.meta.env.VITE_SENTRY_RELEASE?.trim() || undefined;

  Sentry.init({
    dsn,
    release,
    sendDefaultPii: false,
    // Keep default integrations; avoid Session Replay / extra product telemetry.
  });
}
