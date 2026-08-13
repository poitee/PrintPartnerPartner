import type {
  IntegrationConfig,
  IntegrationTestResult,
  PrinterHostStatus,
  PrinterUploadResult,
} from "@print-partner/contracts";
import type { IntegrationAdapter } from "../store.js";
import { assertSafeOutboundUrl } from "../../lib/outbound-url.js";

function normalizeBaseUrl(raw: unknown): string | null {
  if (typeof raw !== "string" || !raw.trim()) return null;
  return raw.trim().replace(/\/+$/, "");
}

function authHeaders(config: IntegrationConfig): Record<string, string> {
  const apiKey = config.api_key ?? config.apiKey;
  if (typeof apiKey !== "string" || !apiKey.trim() || apiKey === "****") return {};
  const key = apiKey.trim();
  // Moonraker API keys use X-Api-Key; JWTs use Authorization Bearer.
  if (key.split(".").length === 3) {
    return { Authorization: `Bearer ${key}` };
  }
  return { "X-Api-Key": key };
}

/** Moonraker legitimately lives on LAN/private IPs; metadata endpoints stay blocked. */
async function moonrakerFetch(
  url: string,
  config: IntegrationConfig,
  init: RequestInit = {},
): Promise<Response> {
  await assertSafeOutboundUrl(url, { allowPrivate: true });
  const headers = new Headers(init.headers);
  for (const [k, v] of Object.entries(authHeaders(config))) {
    if (!headers.has(k)) headers.set(k, v);
  }
  return fetch(url, {
    ...init,
    headers,
    signal: init.signal ?? AbortSignal.timeout(30_000),
  });
}

function mapPrintState(raw: string | undefined): PrinterHostStatus["state"] {
  const state = (raw ?? "").toLowerCase();
  if (state === "printing") return "printing";
  if (state === "paused") return "paused";
  if (state === "complete") return "complete";
  if (state === "error") return "error";
  // cancelled / standby → idle (must not auto-checkoff)
  if (state === "standby" || state === "cancelled") return "idle";
  if (!state) return "unknown";
  return "idle";
}

async function queryStatus(config: IntegrationConfig): Promise<PrinterHostStatus> {
  const baseUrl = normalizeBaseUrl(config.base_url ?? config.baseUrl);
  if (!baseUrl) return { state: "offline", message: "base_url is required" };

  const objects = "print_stats&virtual_sdcard&display_status";
  const res = await moonrakerFetch(
    `${baseUrl}/printer/objects/query?${objects}`,
    config,
  );
  if (!res.ok) {
    return { state: "offline", message: `Moonraker returned HTTP ${res.status}` };
  }
  const body = (await res.json()) as {
    result?: {
      status?: {
        print_stats?: { state?: string; filename?: string };
        virtual_sdcard?: { progress?: number };
        display_status?: { progress?: number };
      };
    };
  };
  const status = body.result?.status;
  const printStats = status?.print_stats;
  const progressFraction =
    status?.virtual_sdcard?.progress ?? status?.display_status?.progress;
  const progress =
    typeof progressFraction === "number" && Number.isFinite(progressFraction)
      ? Math.round(Math.min(100, Math.max(0, progressFraction * 100)))
      : undefined;
  const filename = printStats?.filename?.trim() || undefined;
  const state = mapPrintState(printStats?.state);
  return {
    state,
    progress: state === "printing" || state === "paused" ? progress : undefined,
    filename,
    message:
      state === "printing" && filename
        ? `Printing ${filename}`
        : state === "complete"
          ? filename
            ? `Complete · ${filename}`
            : "Complete"
          : state === "idle"
            ? "Idle"
            : printStats?.state,
  };
}

export const moonrakerAdapter: IntegrationAdapter = {
  type: "moonraker",

  async testConnection(config: IntegrationConfig): Promise<IntegrationTestResult> {
    const baseUrl = normalizeBaseUrl(config.base_url ?? config.baseUrl);
    if (!baseUrl) {
      return { ok: false, message: "base_url is required" };
    }
    try {
      const res = await moonrakerFetch(`${baseUrl}/server/info`, config, {
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
      const status = await queryStatus(config);
      return [
        {
          id: "default",
          name: "Moonraker printer",
          type: "moonraker",
          status: status.state,
        },
      ];
    } catch {
      return [];
    }
  },

  async getStatus(config: IntegrationConfig): Promise<PrinterHostStatus> {
    try {
      return await queryStatus(config);
    } catch (e) {
      return {
        state: "offline",
        message: e instanceof Error ? e.message : String(e),
      };
    }
  },

  async uploadFile(
    config: IntegrationConfig,
    bytes: Uint8Array,
    filename: string,
    options?: { start?: boolean },
  ): Promise<PrinterUploadResult> {
    const baseUrl = normalizeBaseUrl(config.base_url ?? config.baseUrl);
    if (!baseUrl) {
      return { ok: false, message: "base_url is required" };
    }
    const safeName = filename.replace(/[/\\]/g, "_").trim() || "print.gcode";
    try {
      const form = new FormData();
      form.append("file", new Blob([Buffer.from(bytes)]), safeName);
      form.append("root", "gcodes");

      const uploadUrl = `${baseUrl}/server/files/upload`;
      const uploadRes = await moonrakerFetch(uploadUrl, config, {
        method: "POST",
        body: form,
        signal: AbortSignal.timeout(120_000),
      });
      if (!uploadRes.ok) {
        const text = await uploadRes.text().catch(() => "");
        return {
          ok: false,
          message: `Upload failed (HTTP ${uploadRes.status})${text ? `: ${text.slice(0, 200)}` : ""}`,
        };
      }

      let started = false;
      if (options?.start) {
        const startUrl = `${baseUrl}/printer/print/start?filename=${encodeURIComponent(safeName)}`;
        const startRes = await moonrakerFetch(startUrl, config, {
          method: "POST",
          signal: AbortSignal.timeout(15_000),
        });
        if (!startRes.ok) {
          const text = await startRes.text().catch(() => "");
          return {
            ok: true,
            remote_path: safeName,
            started: false,
            message: `Uploaded, but start failed (HTTP ${startRes.status})${text ? `: ${text.slice(0, 200)}` : ""}`,
          };
        }
        started = true;
      }

      return {
        ok: true,
        remote_path: safeName,
        started,
        message: started ? `Uploaded and started ${safeName}` : `Uploaded ${safeName}`,
      };
    } catch (e) {
      return {
        ok: false,
        message: e instanceof Error ? e.message : String(e),
      };
    }
  },
};
