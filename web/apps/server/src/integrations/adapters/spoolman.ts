import type { IntegrationConfig, IntegrationTestResult } from "@print-partner/contracts";
import type { IntegrationAdapter } from "../store.js";

export const spoolmanAdapter: IntegrationAdapter = {
  type: "spoolman",

  async testConnection(_config: IntegrationConfig): Promise<IntegrationTestResult> {
    return { ok: false, message: "Spoolman integration not implemented yet" };
  },
};
