import { createReadStream, existsSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import type { FastifyInstance } from "fastify";
import { safePathUnderRoot } from "../lib/secure-path.js";

type RouteDeps = { dataDir: string };

export async function registerExportRoutes(app: FastifyInstance, deps: RouteDeps): Promise<void> {
  app.get("/exports/*", async (request, reply) => {
    const wildcard = (request.params as { "*": string })["*"] ?? "";
    const key = wildcard.replace(/^\/+/, "");
    if (!key || key.includes("..")) {
      return reply.status(400).send({ detail: "Invalid export path" });
    }
    const exportsRoot = join(deps.dataDir, "exports");
    const full = safePathUnderRoot(exportsRoot, key);
    if (!full || !existsSync(full)) {
      return reply.status(404).send({ detail: "Export file not found" });
    }
    const st = statSync(full);
    if (st.isDirectory()) {
      return reply.status(400).send({ detail: "Path is a directory" });
    }
    const name = basename(full);
    const isZip = name.endsWith(".zip");
    const isHtml = name.endsWith(".html");
    const type = isZip
      ? "application/zip"
      : isHtml
        ? "text/html; charset=utf-8"
        : "application/octet-stream";
    return reply
      .header("Content-Type", type)
      .header("Content-Disposition", `attachment; filename="${name}"`)
      .send(createReadStream(full));
  });
}
