import type { FastifyInstance } from "fastify";
import type { ServerConfig } from "../config.js";
import type { AppPorts } from "../ports/index.js";
import { pingBundle } from "../db/database.js";
import type { SaasDbStore } from "../adapters/saas/index.js";

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
      dbOk = false;
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

    return {
      ok: dbOk,
      version: config.version,
      deploy_mode: config.deployMode,
      data_dir: config.dataDir,
      port: config.port,
      api_version: "v1",
      capabilities: ["kit_planning", "jobs_ws", "fleet_presets", "integrations_api"],
      db: {
        connected: dbOk,
        driver: saasDb.bundle?.driver ?? "sqlite",
        postgres: postgresOk,
      },
    };
  });
}
