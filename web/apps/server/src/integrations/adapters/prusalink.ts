import type { IntegrationConfig, IntegrationTestResult } from "@print-partner/contracts";
import type { IntegrationAdapter } from "../store.js";

export const prusalinkAdapter: IntegrationAdapter = {
  type: "prusalink",

  async testConnection(_config: IntegrationConfig): Promise<IntegrationTestResult> {
    return { ok: false, message: "Prusa Link integration not implemented yet" };
  },
};
