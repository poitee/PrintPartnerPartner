import type { DeployMode } from "@print-partner/contracts";

export type { DeployMode };

export type ServerConfig = {
  deployMode: DeployMode;
  host: string;
  port: number;
  dataDir: string;
  version: string;
  corsOrigin: string | boolean | string[];
  staticDir: string | null;
  databaseUrl: string | null;
  saasBasicAuth: string | null;
  saasAllowAnonymous: boolean;
  authRequired: boolean;
  sessionSecret: string | null;
  githubClientId: string | null;
  githubClientSecret: string | null;
  githubCallbackUrl: string | null;
  githubOAuthConfigured: boolean;
  authSuccessRedirect: string;
  basicAuthUser: string | null;
  basicAuthPass: string | null;
  s3Bucket: string | null;
  s3Region: string | null;
  uploadMaxBytes: number;
  /** Self-host: optional key for /api/v1 automation clients */
  integrationApiKey: string | null;
  /** When false, skip GitHub / override version checks for app updates */
  updateCheckEnabled: boolean;
  /** GitHub owner/repo for release lookup (e.g. poitee/PrintPartnerPartner) */
  githubRepo: string;
  /** Air-gapped override: treat this as the latest published version */
  latestVersionOverride: string | null;
  /** In-memory cache TTL for update checks (hours) */
  updateCheckCacheHours: number;
};

const DEFAULT_DATA_DIR = process.env.PRINT_PARTNER_DATA_DIR ?? "./data";

function parseDeployMode(raw: string | undefined): DeployMode {
  if (raw === "saas") return "saas";
  return "self-host";
}

function resolveBasicAuth(): string | null {
  if (process.env.SAAS_BASIC_AUTH) return process.env.SAAS_BASIC_AUTH;
  const user = process.env.BASIC_AUTH_USER ?? process.env.SAAS_BASIC_AUTH_USER;
  const pass = process.env.BASIC_AUTH_PASS ?? process.env.SAAS_BASIC_AUTH_PASS;
  if (user && pass) return `${user}:${pass}`;
  return null;
}

export function validateProductionConfig(config: ServerConfig): void {
  const isProd = process.env.NODE_ENV === "production";
  if (!isProd) return;
  if (config.deployMode === "saas" && !config.sessionSecret && config.githubOAuthConfigured) {
    throw new Error("SESSION_SECRET is required in production SaaS mode with OAuth enabled");
  }
  if (config.deployMode === "saas" && config.authRequired && !config.sessionSecret && !config.saasBasicAuth) {
    throw new Error("SESSION_SECRET or SAAS_BASIC_AUTH is required when SaaS auth is enabled");
  }
}

function parseCorsOrigin(raw: string | undefined): string | boolean | string[] {
  if (!raw || raw === "true") return true;
  if (raw === "false") return false;
  const origins = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (origins.length === 1) return origins[0]!;
  if (origins.length > 1) return origins;
  return true;
}

export function loadConfig(): ServerConfig {
  const deployMode = parseDeployMode(process.env.DEPLOY_MODE);
  const port = Number(process.env.PORT ?? 18765);
  const host = process.env.HOST ?? "127.0.0.1";
  const dataDir =
    deployMode === "saas"
      ? (process.env.SAAS_DATA_DIR ?? DEFAULT_DATA_DIR)
      : (process.env.PRINT_PARTNER_DATA_DIR ?? DEFAULT_DATA_DIR);

  const githubClientId = process.env.GITHUB_CLIENT_ID ?? null;
  const githubClientSecret = process.env.GITHUB_CLIENT_SECRET ?? null;
  const githubCallbackUrl = process.env.GITHUB_CALLBACK_URL ?? null;

  const saasBasicAuth = resolveBasicAuth();
  const saasAllowAnonymous = process.env.SAAS_ALLOW_ANONYMOUS === "1";
  const authRequired =
    deployMode === "saas" &&
    !saasAllowAnonymous &&
    Boolean(saasBasicAuth || githubClientId);

  const basicUser = process.env.BASIC_AUTH_USER ?? null;
  const basicPass = process.env.BASIC_AUTH_PASS ?? null;

  return {
    deployMode,
    host,
    port,
    dataDir,
    version: process.env.PP_VERSION ?? "0.1.0-web",
    corsOrigin: parseCorsOrigin(process.env.ALLOWED_ORIGINS ?? process.env.CORS_ORIGIN),
    staticDir: process.env.STATIC_DIR ?? null,
    databaseUrl: process.env.DATABASE_URL ?? null,
    saasBasicAuth,
    saasAllowAnonymous,
    authRequired,
    sessionSecret: process.env.SESSION_SECRET ?? null,
    githubClientId,
    githubClientSecret,
    githubCallbackUrl,
    githubOAuthConfigured: Boolean(githubClientId && githubClientSecret && githubCallbackUrl),
    authSuccessRedirect: process.env.AUTH_SUCCESS_REDIRECT ?? "/",
    basicAuthUser: basicUser,
    basicAuthPass: basicPass,
    s3Bucket: process.env.S3_BUCKET ?? null,
    s3Region: process.env.S3_REGION ?? process.env.AWS_REGION ?? null,
    uploadMaxBytes: Number(process.env.UPLOAD_MAX_BYTES ?? 512 * 1024 * 1024),
    integrationApiKey: process.env.PRINT_PARTNER_API_KEY?.trim() || null,
    updateCheckEnabled: process.env.PRINT_PARTNER_UPDATE_CHECK !== "0",
    githubRepo: process.env.GITHUB_REPO?.trim() || "poitee/PrintPartnerPartner",
    latestVersionOverride: process.env.PRINT_PARTNER_LATEST_VERSION?.trim() || null,
    updateCheckCacheHours: Number(process.env.PRINT_PARTNER_UPDATE_CHECK_CACHE_HOURS ?? 12),
  };
}
