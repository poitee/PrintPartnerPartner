import type { IntegrationConfig, IntegrationTestResult } from "@print-partner/contracts";
import type { IntegrationAdapter } from "../store.js";

function normalizeBaseUrl(raw: unknown): string | null {
  if (typeof raw !== "string" || !raw.trim()) return null;
  return raw.trim().replace(/\/+$/, "");
}

export const moonrakerAdapter: IntegrationAdapter = {
  type: "moonraker",

  async testConnection(config: IntegrationConfig): Promise<IntegrationTestResult> {
    const baseUrl = normalizeBaseUrl(config.base_url ?? config.baseUrl);
    if (!baseUrl) {
      return { ok: false, message: "base_url is required" };
    }
    try {
      const res = await fetch(`${baseUrl}/server/info`, {
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) {
        return { ok: false, message: `Moonraker returned HTTP ${res.status}` };
      }
      const body = (await res.json()) as { result?: { klippy_state?: string } };
      const state = body.result?.klippy_state ?? "unknown";
      return { ok: true, message: `Connected (klippy: ${state})` };
    } catch (e) {
      return {
        ok: false,
        message: e instanceof Error ? e.message : String(e),
      };
    }
  },

  async listDevices(config: IntegrationConfig) {
    const baseUrl = normalizeBaseUrl(config.base_url ?? config.baseUrl);
    if (!baseUrl) return [];
    try {
      const res = await fetch(`${baseUrl}/printer/objects/query?print_stats`, {
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) return [];
      return [{ id: "default", name: "Moonraker printer", type: "moonraker" }];
    } catch {
      return [];
    }
  },
};
