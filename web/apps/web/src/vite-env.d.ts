/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL?: string;
  /** Optional Google OAuth Web client id for Drive (dev fallback if /health has none). */
  readonly VITE_GOOGLE_CLIENT_ID?: string;
  /** Browser Sentry DSN — baked only into trusted release builds when configured. */
  readonly VITE_SENTRY_DSN?: string;
  /** Sentry release name; must match CI-uploaded source maps (e.g. 3.1.0-web). */
  readonly VITE_SENTRY_RELEASE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
