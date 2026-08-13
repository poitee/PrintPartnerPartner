import { describe, expect, it } from "vitest";
import { join } from "node:path";
import { assertPrinterUploadArtifactPath } from "./printer-send-queue-store.js";

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
