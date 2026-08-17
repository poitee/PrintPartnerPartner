import { basename } from "node:path";
import type { FastifyInstance } from "fastify";
import { openExportFileStream } from "../lib/secure-path.js";

type RouteDeps = { dataDir: string };

export async function registerExportRoutes(app: FastifyInstance, deps: RouteDeps): Promise<void> {
  app.get("/exports/*", async (request, reply) => {
    const wildcard = (request.params as { "*": string })["*"] ?? "";
    const key = wildcard.replace(/^\/+/, "");
    if (!key || key.includes("..")) {
      return reply.status(400).send({ detail: "Invalid export path" });
    }
    const stream = openExportFileStream(deps.dataDir, key);
    if (!stream) {
      return reply.status(404).send({ detail: "Export file not found" });
    }
    const name = basename(key);
    const lower = name.toLowerCase();
    const isZip = lower.endsWith(".zip");
    const isHtml = lower.endsWith(".html");
    // Slicer plate thumbnails (auto-slice writes gcode/thumbnails/plate_NN.png)
    // are displayed in the UI via <img src>, so they must be served inline with
    // their real image type rather than as an octet-stream attachment.
    const isPng = lower.endsWith(".png");
    const type = isZip
      ? "application/zip"
      : isHtml
        ? "text/html; charset=utf-8"
        : isPng
          ? "image/png"
          : "application/octet-stream";
    return reply
      .header("Content-Type", type)
      .header(
        "Content-Disposition",
        `${isPng ? "inline" : "attachment"}; filename="${name}"`,
      )
      .send(stream);
  });
}
