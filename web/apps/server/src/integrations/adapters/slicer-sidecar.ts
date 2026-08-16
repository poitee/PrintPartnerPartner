/**
 * Slicer Sidecar integration adapter.
 *
 * The sidecar is a small HTTP companion service that runs on the same host as
 * the slicer CLI (OrcaSlicer, PrusaSlicer, BambuStudio). PP sends a plate 3MF
 * plus resolved profile JSON, the sidecar invokes the CLI, and returns the
 * gcode + thumbnail.
 *
 * Config fields:
 *   url      - Base URL of the sidecar HTTP service, e.g. http://localhost:2814
 *   slicer   - Which CLI the sidecar wraps: "orca" | "prusa" | "bambu"
 */

import type { IntegrationConfig, IntegrationTestResult } from "@print-partner/contracts";
import type { IntegrationAdapter } from "../store.js";
import { assertSafeOutboundUrl } from "../../lib/outbound-url.js";

export type SlicerKind = "orca" | "prusa" | "bambu";

export type SliceRequest = {
  /** Raw bytes of the plate 3MF file. */
  model: Uint8Array;
  /** OrcaSlicer: machine.json content */
  machine_config?: Record<string, unknown>;
  /** OrcaSlicer: process.json content */
  process_config?: Record<string, unknown>;
  /** OrcaSlicer: array of filament config objects */
  filament_configs?: Array<Record<string, unknown>>;
};

export type SliceResult = {
  /** Gcode file bytes. */
  gcode: Uint8Array;
  /** Plate thumbnail PNG bytes (may be empty if sidecar did not produce one). */
  thumbnail: Uint8Array;
  /** Filename suggested by the sidecar (optional). */
  filename?: string;
};

function normUrl(raw: unknown): string | null {
  if (typeof raw !== "string" || !raw.trim()) return null;
  return raw.trim().replace(/\/+$/, "");
}

export async function slicerSidecarSlice(
  config: IntegrationConfig,
  req: SliceRequest,
): Promise<SliceResult> {
  const base = normUrl(config.url);
  if (!base) throw new Error("Slicer sidecar URL not configured");
  const endpoint = `${base}/slice`;
  await assertSafeOutboundUrl(endpoint, { allowPrivate: true });

  // Build multipart form data
  const form = new FormData();
  form.append("model", new Blob([req.model as Uint8Array<ArrayBuffer>], { type: "application/octet-stream" }), "plate.3mf");
  if (req.machine_config) {
    form.append("machine_config", JSON.stringify(req.machine_config));
  }
  if (req.process_config) {
    form.append("process_config", JSON.stringify(req.process_config));
  }
  if (req.filament_configs) {
    form.append("filament_configs", JSON.stringify(req.filament_configs));
  }

  const res = await fetch(endpoint, {
    method: "POST",
    body: form,
    signal: AbortSignal.timeout(300_000), // 5 min timeout for slicing
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Slicer sidecar returned HTTP ${res.status}: ${text.slice(0, 200)}`);
  }

  const contentType = res.headers.get("content-type") ?? "";

  // Sidecar may return a ZIP with gcode + thumbnail, or JSON with base64 fields.
  if (contentType.includes("application/zip") || contentType.includes("application/octet-stream")) {
    const buf = new Uint8Array(await res.arrayBuffer());
    return extractSliceZip(buf);
  }

  if (contentType.includes("application/json")) {
    const json = (await res.json()) as {
      gcode?: string;
      thumbnail?: string;
      filename?: string;
    };
    const gcode = json.gcode ? base64ToBytes(json.gcode) : new Uint8Array(0);
    const thumbnail = json.thumbnail ? base64ToBytes(json.thumbnail) : new Uint8Array(0);
    return { gcode, thumbnail, filename: json.filename };
  }

  // Fall back: treat entire body as raw gcode
  const gcode = new Uint8Array(await res.arrayBuffer());
  return { gcode, thumbnail: new Uint8Array(0) };
}

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * Extract gcode and thumbnail from a ZIP returned by the sidecar.
 * Expects the OrcaSlicer output ZIP which contains:
 *   - *.gcode (or Metadata/*.gcode inside the gcode.3mf)
 *   - Metadata/plate_N.png
 * We use a simple streaming scan rather than pulling in a zip library.
 */
function extractSliceZip(buf: Uint8Array): SliceResult {
  // Dynamically import fflate (already in the project via domain package)
  // For server-side use we use the synchronous unzipSync from fflate.
  // We do a best-effort extraction here; if fflate is absent we return raw buf as gcode.
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { unzipSync } = require("fflate") as { unzipSync: (data: Uint8Array) => Record<string, Uint8Array> };
    const files = unzipSync(buf);
    let gcode = new Uint8Array(0);
    let thumbnail = new Uint8Array(0);
    for (const [name, data] of Object.entries(files)) {
      if (name.endsWith(".gcode") || name.endsWith(".bgcode")) {
        if (!gcode.length || data.length > gcode.length) gcode = data as Uint8Array<ArrayBuffer>;
      }
      if (/plate_\d+\.png$/i.test(name)) {
        thumbnail = data as Uint8Array<ArrayBuffer>;
      }
    }
    return { gcode, thumbnail };
  } catch {
    // Couldn't unzip — return the whole buffer as gcode (best effort).
    return { gcode: buf, thumbnail: new Uint8Array(0) };
  }
}

export const slicerSidecarAdapter: IntegrationAdapter = {
  type: "slicer_sidecar",

  async testConnection(config: IntegrationConfig): Promise<IntegrationTestResult> {
    const base = normUrl(config.url);
    if (!base) return { ok: false, message: "url is required (e.g. http://localhost:2814)" };
    const healthUrl = `${base}/health`;
    try {
      await assertSafeOutboundUrl(healthUrl, { allowPrivate: true });
      const res = await fetch(healthUrl, {
        method: "GET",
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) {
        return { ok: false, message: `Sidecar returned HTTP ${res.status}` };
      }
      const slicer = typeof config.slicer === "string" ? config.slicer : "orca";
      return { ok: true, message: `Slicer sidecar reachable (${slicer})` };
    } catch (e) {
      return {
        ok: false,
        message: e instanceof Error ? e.message : String(e),
      };
    }
  },
};
