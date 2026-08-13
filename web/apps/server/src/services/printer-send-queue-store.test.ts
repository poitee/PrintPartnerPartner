import { describe, expect, it } from "vitest";
import { join } from "node:path";
import type { PrinterSendQueueItem } from "@print-partner/contracts";
import {
  assertPrinterUploadArtifactPath,
  trimPrinterSendQueue,
} from "./printer-send-queue-store.js";

function item(
  id: string,
  state: PrinterSendQueueItem["state"],
): PrinterSendQueueItem {
  return {
    id,
    filename: `${id}.gcode`,
    artifact_path: `/data/exports/printer-uploads/${id}/a.gcode`,
    printer_id: "p1",
    wait_for_idle: true,
    start: true,
    state,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
  };
}

describe("assertPrinterUploadArtifactPath", () => {
  const exportsDir = "/data/exports";

  it("accepts paths under printer-uploads", () => {
    const path = join(exportsDir, "printer-uploads", "abc", "a.gcode");
    expect(assertPrinterUploadArtifactPath(exportsDir, path)).toBe(path);
  });

  it("rejects path escape", () => {
    expect(() =>
      assertPrinterUploadArtifactPath(
        exportsDir,
        join(exportsDir, "printer-uploads", "..", "secrets.txt"),
      ),
    ).toThrow(/Invalid artifact path/);
  });
});

describe("trimPrinterSendQueue", () => {
  it("never drops active items even when over MAX_ITEMS", () => {
    const active = Array.from({ length: 55 }, (_, i) => item(`a${i}`, "queued"));
    const terminal = Array.from({ length: 10 }, (_, i) => item(`t${i}`, "done"));
    const trimmed = trimPrinterSendQueue([...active, ...terminal]);
    expect(trimmed.filter((i) => i.state === "queued")).toHaveLength(55);
    expect(trimmed.some((i) => i.state === "done")).toBe(false);
  });

  it("keeps newest terminal history within remaining capacity", () => {
    const active = [item("a1", "sending")];
    const terminal = Array.from({ length: 60 }, (_, i) => item(`t${i}`, "done"));
    const trimmed = trimPrinterSendQueue([...active, ...terminal]);
    expect(trimmed).toHaveLength(50);
    expect(trimmed[0]?.id).toBe("a1");
    expect(trimmed.at(-1)?.id).toBe("t59");
  });
});
