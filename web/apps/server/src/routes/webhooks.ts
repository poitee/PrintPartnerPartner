import type { FastifyInstance } from "fastify";
import type { WebhookRegistration } from "@print-partner/contracts";
import type { AppRepository } from "../db/repository.js";
import { sendProblem } from "../lib/api-error.js";
import { createWebhook, deleteWebhook, listWebhooks } from "../services/webhook-store.js";

type RouteDeps = { repo: AppRepository };

export async function registerWebhookRoutes(app: FastifyInstance, deps: RouteDeps): Promise<void> {
  app.get("/webhooks", async () => ({ webhooks: listWebhooks(deps.repo) }));

  app.post("/webhooks", async (request, reply) => {
    const body = request.body as {
      url?: string;
      events?: WebhookRegistration["events"];
      secret?: string | null;
    };
    const url = String(body.url ?? "").trim();
    if (!url.startsWith("http://") && !url.startsWith("https://")) {
      return sendProblem(reply, 400, "Bad Request", "url must be http(s)");
    }
    const hook = createWebhook(deps.repo, {
      url,
      events: body.events ?? ["job.done", "job.error"],
      secret: body.secret,
    });
    return reply.status(201).send({ webhook: hook });
  });

  app.delete("/webhooks/:id", async (request, reply) => {
    const id = (request.params as { id: string }).id;
    if (!deleteWebhook(deps.repo, id)) {
      return sendProblem(reply, 404, "Not Found", "Webhook not found");
    }
    return reply.status(204).send();
  });
}
