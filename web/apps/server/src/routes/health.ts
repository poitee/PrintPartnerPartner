import type { FastifyInstance } from "fastify";
import type { ServerConfig } from "../config.js";
import type { AppPorts } from "../ports/index.js";
import { pingBundle } from "../db/database.js";
import type { SaasDbStore } from "../adapters/saas/index.js";
import type { AppRepository } from "../db/repository.js";
import { resolveAssistantRuntime } from "../assistant/resolve-assistant.js";

function tryGetRepository(ports: AppPorts): AppRepository | null {
  const runtime = ports as AppPorts & {
    repository?: AppRepository;
    db?: { repository?: AppRepository | null; defaultRepository?: AppRepository | null };
  };
  try {
    if (runtime.repository) return runtime.repository;
  } catch {
    /* not connected yet */
  }
  return runtime.db?.repository ?? runtime.db?.defaultRepository ?? null;
}

export async function registerHealthRoutes(
  app: FastifyInstance,
  config: ServerConfig,
  ports: AppPorts,
): Promise<void> {
  app.get("/health", async () => {
    let dbOk = false;
    let postgresOk: boolean | null = null;

    try {
      await ports.db.ping();
      dbOk = true;
    } catch {
      /* dbOk stays false */
    }

    const saasDb = ports.db as Partial<SaasDbStore>;
    if (saasDb.bundle) {
      try {
        const status = await pingBundle(saasDb.bundle);
        dbOk = status.app;
        postgresOk = status.postgres;
      } catch {
        /* ignore */
      }
    }

    let aiAssistant = config.aiEnabled;
    if (!aiAssistant) {
      const repo = tryGetRepository(ports);
      if (repo) {
        try {
          aiAssistant = resolveAssistantRuntime(repo, config).enabled;
        } catch {
          /* ignore */
        }
      }
    }

    return {
      ok: dbOk,
      version: config.version,
      deploy_mode: config.deployMode,
      multi_user: config.multiUser,
      data_dir: config.dataDir,
      port: config.port,
      api_version: "v1",
      capabilities: [
        "kit_planning",
        "jobs_ws",
        "fleet_presets",
        "integrations_api",
        ...(config.multiUser ? ["multi_user_auth", "plan_sharing"] : []),
        ...(config.smtpConfigured ? ["password_reset_email"] : []),
        ...(aiAssistant ? ["ai_assistant"] : []),
        ...(config.googleClientId ? ["google_drive_manifest"] : []),
      ],
      db: {
        connected: dbOk,
        driver: saasDb.bundle?.driver ?? "sqlite",
        postgres: postgresOk,
      },
      google_drive: {
        client_id: config.googleClientId,
      },
    };
  });
}
