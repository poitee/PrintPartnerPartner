import { describe, expect, it, vi } from "vitest";
import type { FastifyRequest } from "fastify";
import { parsePrinterUploadMultipart } from "./printer-upload-multipart.js";

vi.mock("./printer-upload-job.js", () => ({
  isAllowedPrinterUploadFilename: () => true,
  streamPrinterUploadArtifact: vi.fn(async () => "/tmp/plate.gcode"),
}));

describe("parsePrinterUploadMultipart plate revision binding", () => {
  it("reads plate_revision_id from the upload form", async () => {
    const request = {
      async *parts() {
        yield { type: "field", fieldname: "printer_id", value: "p1" };
        yield { type: "field", fieldname: "profile_id", value: "7" };
        yield { type: "field", fieldname: "plate_revision_id", value: "19" };
        yield {
          type: "file",
          fieldname: "file",
          filename: "plate.gcode",
          file: { resume() {} },
        };
      },
    } as unknown as FastifyRequest;

    const parsed = await parsePrinterUploadMultipart(request, {
      exportsDir: "/tmp/exports",
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.plate_revision_id).toBe(19);
    expect(parsed.value.profile_id).toBe(7);
  });
});
