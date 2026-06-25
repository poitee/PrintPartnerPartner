import type { FastifyInstance } from "fastify";
import type { ServerConfig } from "../config.js";
import type { AppRepository } from "../db/repository.js";
import { registerExportRoutes } from "./exports.js";
import { registerImportRoutes } from "./imports.js";
import { registerLegalRoutes } from "./legal.js";
import { registerManifestRoutes } from "./manifest.js";
import { registerPartRoutes } from "./parts.js";
import { registerPlanRoutes } from "./plans.js";
import { registerPrintPlanRoutes } from "./print-plan.js";
import { registerPrinterRoutes } from "./printers.js";
import { registerRepoManifestRoutes } from "./repo-manifest.js";
import {
  registerSettingsRoutes,
  registerSourceNamingRoutes,
  registerStubRoutes,
} from "./settings.js";
import { registerSourceRoutes } from "./sources.js";
import { registerJobRoutes, type InProcessJobRunner } from "./jobs.js";
import { registerApiV1ExtensionRoutes } from "./api-v1-extensions.js";
import { registerIntegrationRoutes } from "./integrations.js";
import { registerWebhookRoutes } from "./webhooks.js";
import { createIntegrationPort } from "../integrations/store.js";
import { getIntegrationAdapter } from "../integrations/registry.js";

export type CoreRouteDeps = {
  repo: AppRepository;
  reposDir: string;
  sourcesDir: string;
  thumbsDir: string;
  coversDir: string;
  dataDir: string;
  config: ServerConfig;
  jobs: InProcessJobRunner;
};

export type CoreRouteOptions = {
  /** v1-only routes: integrations, webhooks, artifacts, job list */
  apiV1Extensions?: boolean;
};

export async function registerCoreRoutes(
  app: FastifyInstance,
  deps: CoreRouteDeps,
  options: CoreRouteOptions = {},
): Promise<void> {
  const routeDeps = {
    repo: deps.repo,
    reposDir: deps.reposDir,
    sourcesDir: deps.sourcesDir,
    thumbsDir: deps.thumbsDir,
    coversDir: deps.coversDir,
  };

  await registerSourceRoutes(app, routeDeps);
  await registerPlanRoutes(app, {
    repo: deps.repo,
    dataDir: deps.dataDir,
    thumbsDir: deps.thumbsDir,
  });
  await registerPartRoutes(app, { repo: deps.repo, thumbsDir: deps.thumbsDir });
  await registerExportRoutes(app, { dataDir: deps.dataDir });
  await registerImportRoutes(app, { repo: deps.repo });
  await registerSettingsRoutes(app, { repo: deps.repo, dataDir: deps.dataDir, config: deps.config });
  await registerSourceNamingRoutes(app, { repo: deps.repo, dataDir: deps.dataDir });
  await registerStubRoutes(app, { repo: deps.repo, dataDir: deps.dataDir });
  await registerLegalRoutes(app);
  await registerRepoManifestRoutes(app, { repo: deps.repo });
  await registerPrinterRoutes(app, { repo: deps.repo });
  await registerPrintPlanRoutes(app, { repo: deps.repo });
  await registerManifestRoutes(app, { repo: deps.repo });

  if (options.apiV1Extensions) {
    await registerApiV1ExtensionRoutes(app, {
      repo: deps.repo,
      jobs: deps.jobs,
    });
    const integrations = createIntegrationPort({
      repo: deps.repo,
      getAdapter: getIntegrationAdapter,
    });
    await registerIntegrationRoutes(app, { integrations, repo: deps.repo });
    await registerWebhookRoutes(app, { repo: deps.repo });
  }

  await registerJobRoutes(app, deps.jobs, deps.config);
}
