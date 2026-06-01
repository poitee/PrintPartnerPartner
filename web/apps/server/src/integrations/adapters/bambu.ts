import type { IntegrationConfig, IntegrationTestResult } from "@print-partner/contracts";
import type { IntegrationAdapter } from "../store.js";

export const bambuAdapter: IntegrationAdapter = {
  type: "bambu",

  async testConnection(_config: IntegrationConfig): Promise<IntegrationTestResult> {
    return { ok: false, message: "Bambu integration not implemented yet" };
  },
};
