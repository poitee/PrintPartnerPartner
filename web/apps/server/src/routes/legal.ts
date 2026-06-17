import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { FastifyInstance } from "fastify";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../../../..");

const FILES: Record<string, string> = {
  summary: "LICENSE-SUMMARY.md",
  license: "LICENSE",
  attribution: "ATTRIBUTION.md",
  "third-party": "THIRD_PARTY_NOTICES.md",
};

export async function registerLegalRoutes(app: FastifyInstance): Promise<void> {
  for (const [name, file] of Object.entries(FILES)) {
    app.get(`/legal/${name}`, async (_request, reply) => {
      try {
        const text = readFileSync(join(REPO_ROOT, file), "utf8");
        return reply.type("text/plain; charset=utf-8").send(text);
      } catch {
        return reply.status(404).send({ detail: "Document not found" });
      }
    });
  }
}
