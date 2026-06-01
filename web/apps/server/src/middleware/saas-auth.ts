import type { FastifyInstance } from "fastify";
import type { ServerConfig } from "../config.js";
import { registerTenantMiddleware as registerTenant } from "../routes/auth.js";

/** Legacy export — tenant + auth middleware lives in routes/auth.ts */
export function registerSaasAuth(app: FastifyInstance, config: ServerConfig): void {
  registerTenant(app, config);
}
