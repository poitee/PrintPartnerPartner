import type { PrinterHostStatus } from "../api/engine";

/** Format optional ETA for the Progress live strip. */
export function formatEtaSeconds(etaSeconds: number | undefined | null): string | null {
  if (etaSeconds == null || !Number.isFinite(etaSeconds) || etaSeconds < 0) return null;
  const s = Math.round(etaSeconds);
  if (s < 60) return `~${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `~${m}m`;
  const h = Math.floor(m / 60);
  const rem = m % 60;
  return rem > 0 ? `~${h}h ${rem}m` : `~${h}h`;
}

export function printerLiveStripTone(
  state: PrinterHostStatus["state"] | undefined,
): "idle" | "printing" | "paused" | "complete" | "error" | "offline" | "unknown" {
  switch (state) {
    case "idle":
    case "printing":
    case "paused":
    case "complete":
    case "error":
    case "offline":
      return state;
    default:
      return "unknown";
  }
}

/**
 * One-line summary for a linked host on Progress.
 * Example: `Shop Voron · Printing frame_x.gcode · 34% · ETA ~12m`
 */
export function formatPrinterLiveLine(opts: {
  name: string;
  status: PrinterHostStatus | null | undefined;
}): string {
  const { name, status } = opts;
  if (!status) return `${name} · …`;

  if (status.state === "offline") {
    return `${name} · Offline`;
  }
  if (status.state === "error") {
    const detail = status.message?.trim();
    return detail ? `${name} · Error · ${detail}` : `${name} · Error`;
  }
  if (status.state === "printing" || status.state === "paused") {
    const parts = [name, status.state === "paused" ? "Paused" : "Printing"];
    const filename = status.filename?.trim();
    if (filename) parts.push(filename);
    if (status.progress != null && Number.isFinite(status.progress)) {
      parts.push(`${Math.round(status.progress)}%`);
    }
    const eta = formatEtaSeconds(status.eta_seconds);
    if (eta) parts.push(`ETA ${eta}`);
    return parts.join(" · ");
  }
  if (status.state === "complete") {
    const filename = status.filename?.trim();
    return filename ? `${name} · Complete · ${filename}` : `${name} · Complete`;
  }
  if (status.state === "idle") {
    return `${name} · Idle`;
  }
  const msg = status.message?.trim();
  return msg ? `${name} · ${msg}` : `${name} · ${status.state}`;
}
