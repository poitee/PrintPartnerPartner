import type {
  DeviceSummary,
  IntegrationConfig,
  IntegrationSummary,
  IntegrationTestResult,
  IntegrationType,
} from "@print-partner/contracts";
import type { AppRepository } from "../db/repository.js";

export type IntegrationAdapter = {
  type: IntegrationType;
  testConnection(config: IntegrationConfig): Promise<IntegrationTestResult>;
  listDevices?(config: IntegrationConfig): Promise<DeviceSummary[]>;
};

export interface IntegrationPort {
  list(): IntegrationSummary[];
  get(id: string): IntegrationSummary | null;
  create(input: {
    type: IntegrationType;
    name: string;
    config: IntegrationConfig;
  }): IntegrationSummary;
  update(
    id: string,
    patch: { name?: string; config?: IntegrationConfig },
  ): IntegrationSummary | null;
  delete(id: string): boolean;
  test(id: string): Promise<IntegrationTestResult>;
  listDevices(id: string): Promise<DeviceSummary[]>;
}

export type IntegrationStoreDeps = {
  repo: AppRepository;
  getAdapter(type: IntegrationType): IntegrationAdapter | undefined;
};

const SETTINGS_KEY = "integrations";

const SECRET_KEYS = new Set([
  "api_key",
  "token",
  "password",
  "secret",
  "access_token",
]);

function redactConfig(config: IntegrationConfig): IntegrationConfig {
  const out: IntegrationConfig = {};
  for (const [key, value] of Object.entries(config)) {
    if (SECRET_KEYS.has(key.toLowerCase()) && value != null && value !== "") {
      out[key] = "****";
    } else {
      out[key] = value;
    }
  }
  return out;
}

function loadRaw(repo: AppRepository): IntegrationSummary[] {
  const raw = repo.getSetting(SETTINGS_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as IntegrationSummary[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveRaw(repo: AppRepository, items: IntegrationSummary[]): void {
  repo.setSetting(SETTINGS_KEY, JSON.stringify(items));
}

export function createIntegrationPort(deps: IntegrationStoreDeps): IntegrationPort {
  return {
    list(): IntegrationSummary[] {
      return loadRaw(deps.repo).map((item) => ({
        ...item,
        config: redactConfig(item.config),
      }));
    },

    get(id: string): IntegrationSummary | null {
      const item = loadRaw(deps.repo).find((x) => x.id === id);
      if (!item) return null;
      return { ...item, config: redactConfig(item.config) };
    },

    create(input): IntegrationSummary {
      const now = new Date().toISOString();
      const item: IntegrationSummary = {
        id: crypto.randomUUID(),
        type: input.type,
        name: input.name,
        config: input.config,
        created_at: now,
        updated_at: now,
      };
      const items = loadRaw(deps.repo);
      items.push(item);
      saveRaw(deps.repo, items);
      return { ...item, config: redactConfig(item.config) };
    },

    update(id, patch): IntegrationSummary | null {
      const items = loadRaw(deps.repo);
      const idx = items.findIndex((x) => x.id === id);
      if (idx < 0) return null;
      const existing = items[idx]!;
      const mergedConfig = patch.config
        ? { ...existing.config, ...patch.config }
        : existing.config;
      const updated: IntegrationSummary = {
        ...existing,
        name: patch.name ?? existing.name,
        config: mergedConfig,
        updated_at: new Date().toISOString(),
      };
      items[idx] = updated;
      saveRaw(deps.repo, items);
      return { ...updated, config: redactConfig(updated.config) };
    },

    delete(id): boolean {
      const items = loadRaw(deps.repo);
      const next = items.filter((x) => x.id !== id);
      if (next.length === items.length) return false;
      saveRaw(deps.repo, next);
      return true;
    },

    async test(id): Promise<IntegrationTestResult> {
      const items = loadRaw(deps.repo);
      const item = items.find((x) => x.id === id);
      if (!item) return { ok: false, message: "Integration not found" };
      const adapter = deps.getAdapter(item.type);
      if (!adapter) return { ok: false, message: `Unknown integration type: ${item.type}` };
      return adapter.testConnection(item.config);
    },

    async listDevices(id): Promise<DeviceSummary[]> {
      const items = loadRaw(deps.repo);
      const item = items.find((x) => x.id === id);
      if (!item) return [];
      const adapter = deps.getAdapter(item.type);
      if (!adapter?.listDevices) return [];
      return adapter.listDevices(item.config);
    },
  };
}

/** Internal: full config for adapter calls (not redacted). */
export function getIntegrationConfig(repo: AppRepository, id: string): IntegrationSummary | null {
  return loadRaw(repo).find((x) => x.id === id) ?? null;
}
