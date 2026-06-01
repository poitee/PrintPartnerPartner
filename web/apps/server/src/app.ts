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
import { registerSourceRoutes } from "./routes/sources.js";
import { registerPlanRoutes } from "./routes/plans.js";
import {
  registerJobRoutes,
  registerJobWebSocket,
  createJobRunner,
  type InProcessJobRunner,
} from "./routes/jobs.js";
import { registerPartRoutes } from "./routes/parts.js";
import { registerExportRoutes } from "./routes/exports.js";
import { registerImportRoutes } from "./routes/imports.js";
import { join } from "node:path";
import {
  registerSettingsRoutes,
  registerSourceNamingRoutes,
  registerStubRoutes,
} from "./routes/settings.js";
import { registerPrinterRoutes } from "./routes/printers.js";
import { registerPrintPlanRoutes } from "./routes/print-plan.js";
import { registerManifestRoutes } from "./routes/manifest.js";
import { registerLegalRoutes } from "./routes/legal.js";
import { registerRepoManifestRoutes } from "./routes/repo-manifest.js";
import { registerAuthRoutes, registerTenantMiddleware } from "./routes/auth.js";
import { validateProductionConfig } from "./config.js";
import { setRequestTenantId } from "./middleware/tenant-context.js";
import fastifyStatic from "@fastify/static";
import { existsSync } from "node:fs";
import { isBrowserDocumentNavigation, isSpaClientPath } from "./lib/spa-nav.js";
import type { SaasDbStore } from "./adapters/saas/index.js";
import type { AppRepository } from "./db/repository.js";

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

export async function buildApp(config: ServerConfig, ports: RuntimePorts) {
  const app = Fastify({ logger: true, bodyLimit: config.uploadMaxBytes });

  await app.register(cookie);
  registerTenantMiddleware(app, config);
  registerAuthRoutes(app, config);

  await app.register(cors, { origin: config.corsOrigin, credentials: true });
  await app.register(rateLimit, { global: false });
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

  const repository = resolveRepository(ports);
  if (repository) {
    const thumbsDir = join(config.dataDir, "thumbs");
    const coversDir = join(config.dataDir, "covers");
    const routeDeps = {
      repo: repository,
      reposDir: ports.reposDir ?? join(config.dataDir, "repos"),
      sourcesDir: ports.sourcesDir ?? join(config.dataDir, "sources"),
      thumbsDir,
      coversDir,
    };

    await registerSourceRoutes(app, routeDeps);
    await registerPlanRoutes(app, { repo: repository });
    await registerPartRoutes(app, { repo: repository, thumbsDir });
    await registerExportRoutes(app, { dataDir: config.dataDir });
    await registerImportRoutes(app, { repo: repository });
    await registerSettingsRoutes(app, { repo: repository, dataDir: config.dataDir });
    await registerSourceNamingRoutes(app, { repo: repository, dataDir: config.dataDir });
    await registerStubRoutes(app, { repo: repository, dataDir: config.dataDir });
    await registerLegalRoutes(app);
    await registerRepoManifestRoutes(app, { repo: repository });
    await registerPrinterRoutes(app, { repo: repository });
    await registerPrintPlanRoutes(app, { repo: repository });
    await registerManifestRoutes(app, { repo: repository });

    app.post(
      "/admin/import-kit-bundle",
      { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } },
      async (request, reply) => {
        if (config.deployMode === "saas" && config.authRequired && !request.sessionUser) {
          return reply.status(401).send({ detail: "Authentication required" });
        }
        const body = request.body as { path?: string; new_name?: string };
        const path = String(body.path ?? "");
        if (!path) return reply.status(400).send({ detail: "path is required" });
        const { loadKitBundleBytes } = await import("./services/export-kit.js");
        const { safeDataDirPath } = await import("./lib/secure-path.js");
        const safe = safeDataDirPath(config.dataDir, path);
        if (!safe) return reply.status(400).send({ detail: "Invalid path" });
        const data = loadKitBundleBytes(safe);
        return repository.importKitBundle(data, body.new_name ?? null);
      },
    );

    if (config.staticDir && existsSync(config.staticDir)) {
      await app.register(fastifyStatic, {
        root: config.staticDir,
        prefix: "/",
        wildcard: false,
      });
      app.setNotFoundHandler((request, reply) => {
        if (request.method === "GET" && !request.url.includes(".")) {
          return reply.sendFile("index.html", config.staticDir!);
        }
        return reply.status(404).send({ detail: "Not found" });
      });
    }

    const getRepo = () => repository;
    const jobs = (ports.jobs as InProcessJobRunner) ?? createJobRunner(getRepo, config.dataDir);
    await registerJobRoutes(app, jobs, config);
    registerJobWebSocket(app, jobs);
  } else {
    registerJobWebSocket(
      app,
      createJobRunner(() => {
        throw new Error("Database not available");
      }, config.dataDir),
    );
  }

  return app;
}

export async function startServer(config: ServerConfig) {
  validateProductionConfig(config);
  const ports = createPorts(config);
  await ports.db.connect();

  const app = await buildApp(config, ports);

  try {
    await app.listen({ host: config.host, port: config.port });
    return { app, ports };
  } catch (err) {
    await ports.db.close();
    throw err;
  }
}
