import type { WebhookRegistration } from "@print-partner/contracts";
import type { AppRepository } from "../db/repository.js";

const SETTINGS_KEY = "integration_webhooks_v1";

function loadAll(repo: AppRepository): WebhookRegistration[] {
  const raw = repo.getSetting(SETTINGS_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as WebhookRegistration[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveAll(repo: AppRepository, items: WebhookRegistration[]): void {
  repo.setSetting(SETTINGS_KEY, JSON.stringify(items));
}

export function listWebhooks(repo: AppRepository): WebhookRegistration[] {
  return loadAll(repo);
}

export function createWebhook(
  repo: AppRepository,
  input: { url: string; events: WebhookRegistration["events"]; secret?: string | null },
): WebhookRegistration {
  const row: WebhookRegistration = {
    id: `wh-${crypto.randomUUID().slice(0, 12)}`,
    url: input.url.trim(),
    events: input.events.length ? input.events : ["job.done", "job.error"],
    secret: input.secret ?? null,
    created_at: new Date().toISOString(),
  };
  const all = loadAll(repo);
  all.push(row);
  saveAll(repo, all);
  return row;
}

export function deleteWebhook(repo: AppRepository, id: string): boolean {
  const all = loadAll(repo);
  const next = all.filter((x) => x.id !== id);
  if (next.length === all.length) return false;
  saveAll(repo, next);
  return true;
}

export async function dispatchWebhooks(
  repo: AppRepository,
  event: "job.done" | "job.error",
  payload: Record<string, unknown>,
): Promise<void> {
  const hooks = loadAll(repo).filter((h) => h.events.includes(event));
  await Promise.all(
    hooks.map(async (hook) => {
      try {
        const headers: Record<string, string> = {
          "Content-Type": "application/json",
          "X-Print-Partner-Event": event,
        };
        if (hook.secret) headers["X-Print-Partner-Signature"] = hook.secret;
        await fetch(hook.url, {
          method: "POST",
          headers,
          body: JSON.stringify({ event, ...payload }),
          signal: AbortSignal.timeout(10_000),
        });
      } catch {
        /* best-effort */
      }
    }),
  );
}
