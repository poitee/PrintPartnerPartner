import type { FastifyInstance } from "fastify";
import type { CoreRouteDeps } from "./core-routes.js";
import { registerPlanRoutes } from "./plans.js";

export async function registerApiV2PlanPlugin(
  app: FastifyInstance,
  deps: CoreRouteDeps,
): Promise<void> {
  app.get("/", async () => ({
    version: "2",
    scope: "plans",
    plans: "/api/v2/plans",
    openapi: "/api/v2/openapi.json",
  }));
  await registerPlanRoutes(
    app,
    {
      repo: deps.repo,
      dataDir: deps.dataDir,
      reposDir: deps.reposDir,
      thumbsDir: deps.thumbsDir,
    },
    { summaryContract: "accepted" },
  );
}
