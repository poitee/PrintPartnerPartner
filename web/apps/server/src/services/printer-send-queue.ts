import { existsSync } from "node:fs";
import type { PrinterHostStatus, PrinterSendQueueItem } from "@print-partner/contracts";
import type { AppRepository } from "../db/repository.js";
import { getIntegrationConfig } from "../integrations/store.js";
import { loadFleet } from "./printer-fleet.js";
import {
  assertPrinterUploadArtifactPath,
  getPrinterSendQueueItem,
  listActivePrinterSendQueue,
  updatePrinterSendQueueItem,
} from "./printer-send-queue-store.js";

export type StartPrinterUploadJob = (payload: {
  printer_id: string;
  artifact_path: string;
  filename: string;
  start: boolean;
  host_name?: string;
  profile_id?: number;
  checkoff_units?: PrinterSendQueueItem["checkoff_units"];
}) => Promise<string>;

export type GetHostStatus = (integrationId: string) => Promise<PrinterHostStatus>;

/**
 * Dispatch a queued send when the target host is idle (or force=true).
 * Claims the item as sending, starts printer-upload job, stores job id.
 */
export async function dispatchPrinterSendQueueItem(
  repo: AppRepository,
  exportsDir: string,
  itemId: string,
  deps: {
    startJob: StartPrinterUploadJob;
    getStatus: GetHostStatus;
    force?: boolean;
  },
): Promise<
  | { item: PrinterSendQueueItem; job_id: string }
  | { error: string; status: number }
> {
  const item = getPrinterSendQueueItem(repo, itemId);
  if (!item) return { error: "Queue item not found", status: 404 };
  if (item.state !== "queued" && item.state !== "error") {
    return { error: "Item is not dispatchable", status: 409 };
  }

  let artifactPath: string;
  try {
    artifactPath = assertPrinterUploadArtifactPath(exportsDir, item.artifact_path);
  } catch {
    return { error: "Invalid artifact path", status: 400 };
  }
  if (!existsSync(artifactPath)) {
    updatePrinterSendQueueItem(
      repo,
      item.id,
      { state: "error", error: "Artifact file missing on disk" },
      { requireState: ["queued", "error"] },
    );
    return { error: "Artifact file missing on disk", status: 409 };
  }

  const machine = loadFleet(repo).find((m) => m.id === item.printer_id);
  if (!machine) return { error: "Fleet printer not found", status: 404 };
  const integrationId = machine.integration_id?.trim();
  if (!integrationId) {
    return { error: "Printer is not linked to a host", status: 400 };
  }
  const integration = getIntegrationConfig(repo, integrationId);
  if (!integration) return { error: "Linked host not found", status: 400 };
  if (integration.type !== "moonraker" && integration.type !== "prusalink") {
    return { error: `Upload is not supported for ${integration.type}`, status: 400 };
  }

  if (item.wait_for_idle && !deps.force) {
    const status = await deps.getStatus(integrationId);
    if (status.state !== "idle" && status.state !== "complete") {
      return {
        error: `Printer is ${status.state} — wait for Idle or force dispatch`,
        status: 409,
      };
    }
  }

  const claimed = updatePrinterSendQueueItem(
    repo,
    item.id,
    {
      state: "sending",
      error: undefined,
      host_name: integration.name,
    },
    { requireState: ["queued", "error"] },
  );
  if (!claimed) return { error: "Item changed concurrently", status: 409 };

  try {
    const job_id = await deps.startJob({
      printer_id: item.printer_id,
      artifact_path: artifactPath,
      filename: item.filename,
      start: item.start,
      host_name: integration.name,
      profile_id: item.profile_id,
      checkoff_units: item.checkoff_units,
    });
    const updated = updatePrinterSendQueueItem(repo, item.id, {
      upload_job_id: job_id,
    });
    return { item: updated ?? claimed, job_id };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    updatePrinterSendQueueItem(repo, item.id, {
      state: "error",
      error: message.slice(0, 500),
    });
    return { error: message, status: 500 };
  }
}

/**
 * For each idle linked send host, dispatch at most one waiting queue item
 * targeting that printer.
 */
export async function drainPrinterSendQueue(
  repo: AppRepository,
  exportsDir: string,
  deps: {
    startJob: StartPrinterUploadJob;
    getStatus: GetHostStatus;
  },
): Promise<Array<{ item_id: string; job_id?: string; error?: string }>> {
  const queued = listActivePrinterSendQueue(repo).filter((i) => i.state === "queued");
  const results: Array<{ item_id: string; job_id?: string; error?: string }> = [];
  const usedPrinters = new Set<string>();

  for (const item of queued) {
    if (usedPrinters.has(item.printer_id)) continue;
    const machine = loadFleet(repo).find((m) => m.id === item.printer_id);
    const integrationId = machine?.integration_id?.trim();
    if (!integrationId) continue;

    if (item.wait_for_idle) {
      try {
        const status = await deps.getStatus(integrationId);
        if (status.state !== "idle" && status.state !== "complete") continue;
      } catch {
        continue;
      }
    }

    const dispatched = await dispatchPrinterSendQueueItem(repo, exportsDir, item.id, {
      startJob: deps.startJob,
      getStatus: deps.getStatus,
      force: !item.wait_for_idle,
    });
    if ("error" in dispatched) {
      if (dispatched.status === 409) continue;
      results.push({ item_id: item.id, error: dispatched.error });
      continue;
    }
    usedPrinters.add(item.printer_id);
    results.push({ item_id: item.id, job_id: dispatched.job_id });
  }

  return results;
}

/** Mark queue items done/error from finished printer-upload jobs. */
export function reconcileSendQueueJobResult(
  repo: AppRepository,
  jobId: string,
  result: { ok: boolean; message?: string },
): void {
  const all = listActivePrinterSendQueue(repo);
  const item = all.find((i) => i.upload_job_id === jobId && i.state === "sending");
  if (!item) return;
  updatePrinterSendQueueItem(
    repo,
    item.id,
    result.ok
      ? { state: "done", error: undefined }
      : { state: "error", error: (result.message ?? "Upload failed").slice(0, 500) },
    { requireState: "sending" },
  );
}
