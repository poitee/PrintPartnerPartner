import Fastify from "fastify";
import cors from "@fastify/cors";
import websocket from "@fastify/websocket";
import multipart from "@fastify/multipart";
import cookie from "@fastify/cookie";
import rateLimit from "@fastify/rate-limit";
import type { ServerConfig } from "./config.js";
import { createSelfHostPorts } from "./adapters/self-host/index.js";
import { createSaasPorts } from "./adapters/saas/index.js";
import type { AppPorts } from "./ports/index.js";
import { registerHealthRoutes } from "./routes/health.js";
import {
  registerJobWebSocket,
  createJobRunner,
  type InProcessJobRunner,
} from "./routes/jobs.js";
import { registerCoreRoutes } from "./routes/core-routes.js";
import { registerBackupRoutes } from "./routes/backups.js";
import { registerLoggingRoutes } from "./routes/logging.js";
import { registerApiKeyManagementRoutes } from "./routes/api-key-management.js";
import { registerMetricsRoutes } from "./routes/metrics.js";
import { registerApiV1Plugin, registerOpenApi, registerOpenApiJsonRoutes } from "./routes/api-v1.js";
import { registerAuthRoutes, registerTenantMiddleware } from "./routes/auth.js";
import { registerApiKeyAuth } from "./middleware/api-key.js";
import { registerRequestLoggingMiddleware } from "./middleware/request-logging.js";
import { validateProductionConfig } from "./config.js";
import { setRequestTenantId } from "./middleware/tenant-context.js";
import fastifyStatic from "@fastify/static";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { isBrowserDocumentNavigation, isSpaClientPath } from "./lib/spa-nav.js";
import type { SaasDbStore } from "./adapters/saas/index.js";
import type { SelfHostDbStore } from "./adapters/self-host/index.js";
import type { AppRepository } from "./db/repository.js";
import { getDb } from "./db/client.js";
import { createAuthStore, type AuthStore } from "./services/auth-store.js";

export type RuntimePorts = AppPorts & {
  repository?: AppRepository;
  reposDir?: string;
  sourcesDir?: string;
  getRepository?: (tenantId: string) => AppRepository;
  db: AppPorts["db"] & {
    bundle?: unknown;
    defaultRepository?: AppRepository | null;
  };
};

export function createPorts(config: ServerConfig): RuntimePorts {
  if (config.deployMode === "saas") {
    return createSaasPorts(config.dataDir) as RuntimePorts;
  }
  return createSelfHostPorts(config.dataDir);
}

function resolveRepository(ports: RuntimePorts): AppRepository | null {
  if (ports.repository) return ports.repository;
  if (ports.db && "defaultRepository" in ports.db) {
    const repo = (ports.db as SaasDbStore).defaultRepository;
    if (repo) return repo;
  }
  if (ports.getRepository) return ports.getRepository("default");
  return null;
}

function resolveAuthStore(ports: RuntimePorts, config: ServerConfig): AuthStore | null {
  if (!config.multiUser) return null;
  const db = ports.db;
  if ("sqlite" in db) {
    const sqlite = (db as SelfHostDbStore).sqlite;
    if (sqlite?.drizzle) return createAuthStore(getDb(sqlite), "sqlite");
  }
  if ("bundle" in db) {
    const bundle = (db as SaasDbStore).bundle;
    if (bundle.postgres?.drizzle) return createAuthStore(bundle.postgres.drizzle, "postgres");
    if (bundle.sqlite?.drizzle) return createAuthStore(getDb(bundle.sqlite), "sqlite");
  }
  return null;
}

export async function buildApp(config: ServerConfig, ports: RuntimePorts) {
  const app = Fastify({ logger: true, bodyLimit: config.uploadMaxBytes });
  const authStore = resolveAuthStore(ports, config);

  // Register request logging middleware early
  await registerRequestLoggingMiddleware(app);

  await app.register(cookie);
  registerTenantMiddleware(app, config, authStore);
  registerAuthRoutes(app, config, authStore);
  registerApiKeyAuth(app, config);

  await app.register(cors, { origin: config.corsOrigin, credentials: true });
  // Register rate limiting with smart defaults
  // Global: 1000 requests per minute per IP
  // Health check: allowed via allowList
  // Static files still handled separately
  await app.register(rateLimit, {
    max: 1000,
    timeWindow: "1 minute",
    cache: 10000, // Store limit info for max 10k IPs
    allowList: ["/health"], // Skip rate limiting for health checks
    redis: undefined, // Use in-memory store for single-instance deployments
  });
  await app.register(websocket);
  await app.register(multipart, { limits: { fileSize: config.uploadMaxBytes } });

  app.addHook("preHandler", async (request) => {
    setRequestTenantId(request.tenantId ?? "default");
  });

  if (config.staticDir && existsSync(config.staticDir)) {
    app.addHook("preHandler", async (request, reply) => {
      if (
        isSpaClientPath(request.url) &&
        isBrowserDocumentNavigation(request)
      ) {
        return reply.sendFile("index.html", config.staticDir!);
      }
    });
  }

  await registerHealthRoutes(app, config, ports);
  await registerOpenApi(app, config);

  const repository = resolveRepository(ports);
  if (repository) {
    const thumbsDir = join(config.dataDir, "thumbs");
    const coversDir = join(config.dataDir, "covers");
    const getRepo = () => repository;
    const jobs = (ports.jobs as InProcessJobRunner) ?? createJobRunner(getRepo, config.dataDir);

    // Extract SQLite instance for backup/restore
    let sqlite = null;
    if ("sqlite" in ports.db) {
      sqlite = (ports.db as SelfHostDbStore).sqlite ?? null;
    }

    const coreDeps = {
      repo: repository,
      reposDir: ports.reposDir ?? join(config.dataDir, "repos"),
      sourcesDir: ports.sourcesDir ?? join(config.dataDir, "sources"),
      thumbsDir,
      coversDir,
      dataDir: config.dataDir,
      config,
      jobs,
      authStore,
    };

    await registerCoreRoutes(app, coreDeps);

    // Start background source watcher
    const { startSourceWatcher } = await import("./services/source-watcher.js");
    const watcherHandle = startSourceWatcher(
      repository,
      coreDeps.reposDir,
      jobs,
      () => {
        const webhookUrl = repository.getSetting("discord_notify_webhook_url") || null;
        const notifyOnUpdate = repository.getSetting("discord_notify_on_update", "1") !== "0";
        const notifyOnSync = repository.getSetting("discord_notify_on_sync", "0") !== "0";
        const autoSyncUpdates = repository.getSetting("discord_auto_sync_updates", "1") !== "0";
        return { discordWebhookUrl: webhookUrl, notifyOnUpdate, notifyOnSync, autoSyncUpdates };
      },
    );
    app.addHook("onClose", async () => { watcherHandle.stop(); });

    // Start background slicer profile-sync watcher (chokidar over shared config volumes)
    const { startProfileSyncWatcher, buildProfileSyncSettings } = await import(
      "./services/profile-sync.js"
    );
    const { broadcastProfileSync, registerProfileSyncWebSocket } = await import(
      "./services/profile-sync-broadcast.js"
    );
    registerProfileSyncWebSocket(app);
    const profileSyncSettings = buildProfileSyncSettings(process.env);
    const profileSyncHandle = startProfileSyncWatcher(
      repository,
      profileSyncSettings,
      (event) => broadcastProfileSync(event),
    );
    void profileSyncHandle.syncAll();
    app.addHook("onClose", async () => { profileSyncHandle.stop(); });
    
    // Register backup routes (available regardless of auth mode)
    await registerBackupRoutes(app, {
      dataDir: config.dataDir,
      sqlite,
      appVersion: config.version,
    });
    
    // Register logging routes
    await registerLoggingRoutes(app);
    
    // Register API key management routes
    await registerApiKeyManagementRoutes(app, { repo: repository });
    
    // Register metrics endpoint
    await registerMetricsRoutes(app, { repo: repository });
    
    await app.register(async (v1) => {
      await registerApiV1Plugin(v1, coreDeps);
    }, { prefix: "/api/v1" });

    app.post(
      "/admin/import-kit-bundle",
      { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } },
      async (request, reply) => {
        if (config.deployMode === "saas" && config.authRequired && !request.sessionUser) {
          return reply.status(401).send({ detail: "Authentication required" });
        }
        const body = request.body as { path?: unknown; new_name?: unknown };
        const { readBufferUnderDataDir, trimmedString } = await import("./lib/secure-path.js");
        const path = trimmedString(body.path);
        if (!path) return reply.status(400).send({ detail: "path is required" });
        const { parseKitBundleBuffer } = await import("./services/export-kit.js");
        const buf = readBufferUnderDataDir(config.dataDir, path);
        const data = parseKitBundleBuffer(buf, path);
        return repository.importKitBundle(data, trimmedString(body.new_name) || null);
      },
    );

    if (config.staticDir && existsSync(config.staticDir)) {
      await app.register(fastifyStatic, {
        root: config.staticDir,
        prefix: "/",
        wildcard: false,
        // Vite content-hashes all asset filenames (index-AbCdEf.js) so they
        // are safe to cache forever. index.html must NOT be cached (no hash).
        setHeaders: (reply, filePath) => {
          if (/\/assets\/[^/]+\.[a-f0-9]{8,}\.(js|css|woff2?|png|svg|webp)$/i.test(filePath)) {
            void reply.header("Cache-Control", "public, max-age=31536000, immutable");
          } else {
            void reply.header("Cache-Control", "no-cache");
          }
        },
      });
      app.setNotFoundHandler((request, reply) => {
        if (
          request.method === "GET" &&
          !request.url.includes(".") &&
          isBrowserDocumentNavigation(request)
        ) {
          return reply.sendFile("index.html", config.staticDir!);
        }
        return reply.status(404).send({ detail: "Not found" });
      });
    }

    registerJobWebSocket(app, jobs);
  } else {
    registerJobWebSocket(
      app,
      createJobRunner(() => {
        throw new Error("Database not available");
      }, config.dataDir),
    );
  }

  registerOpenApiJsonRoutes(app);

  return app;
}

export async function startServer(config: ServerConfig) {
  validateProductionConfig(config);
  const ports = createPorts(config);
  await ports.db.connect();

  // One-time migration: move print_outcomes blob → print_job_parts SQL rows.
  if (ports.repository) {
    try {
      const { migratePrintOutcomesBlob } = await import(
        "./services/printer-outcomes-store.js"
      );
      migratePrintOutcomesBlob(ports.repository);
    } catch (err) {
      console.warn("[print-outcomes] blob migration skipped:", err);
    }
  }

  // Best-effort: upsert Advisor notes from shipped/imported domain pack onto matching sources.
  if (ports.repository) {
    try {
      const { backfillAdvisorNotesFromDomainPack } = await import(
        "./assistant/domain-pack.js"
      );
      const result = backfillAdvisorNotesFromDomainPack(
        ports.repository,
        config.dataDir,
      );
      if (result.notes_upserted > 0) {
        console.info(
          `[assistant-domain] backfilled ${result.notes_upserted} advisor note(s) across ${result.sources_matched} source(s)`,
        );
      }
    } catch (err) {
      console.warn("[assistant-domain] note backfill skipped:", err);
    }
  }

  const app = await buildApp(config, ports);

  try {
    await app.listen({ host: config.host, port: config.port });
    return { app, ports };
  } catch (err) {
    await ports.db.close();
    throw err;
  }
}
