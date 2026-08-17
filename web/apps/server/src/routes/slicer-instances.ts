import type { FastifyInstance } from "fastify";
import type { AppRepository, SlicerInstanceRow } from "../db/repository.js";
import type {
  SlicerDialect,
  SlicerInstanceKind,
} from "../services/slicer-instances.js";

type RouteDeps = { repo: AppRepository };

const KINDS: ReadonlySet<string> = new Set(["orca", "prusa", "bambu", "custom"]);
const DIALECTS: ReadonlySet<string> = new Set(["orca_json", "bambu_json", "prusa_ini"]);

function asInstanceJson(row: SlicerInstanceRow) {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    dialect: row.dialect,
    gui_url: row.guiUrl,
    watch_path: row.watchPath,
    docker_target: row.dockerTarget,
    docker_host: row.dockerHost,
    compose_service: row.composeService,
    image: row.image,
    container_name: row.containerName,
    status_cache: row.statusCache,
    status_message: row.statusMessage,
    enabled: row.enabled,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
  };
}

function parseKind(value: unknown): SlicerInstanceKind | null {
  if (typeof value !== "string" || !KINDS.has(value)) return null;
  return value as SlicerInstanceKind;
}

function parseDialect(value: unknown): SlicerDialect | null {
  if (typeof value !== "string" || !DIALECTS.has(value)) return null;
  return value as SlicerDialect;
}

function validateWritable(input: {
  kind: SlicerInstanceKind;
  dialect: SlicerDialect;
  watchPath: string;
  enabled: boolean;
}): string | null {
  if (input.kind === "custom" && input.enabled && !input.watchPath.trim()) {
    return "Custom slicer instances require watch_path when enabled";
  }
  if (input.kind === "custom" && !input.dialect) {
    return "Custom slicer instances require dialect";
  }
  return null;
}

function defaultDialectForKind(kind: SlicerInstanceKind): SlicerDialect {
  if (kind === "prusa") return "prusa_ini";
  if (kind === "bambu") return "bambu_json";
  return "orca_json";
}

export async function registerSlicerInstanceRoutes(
  app: FastifyInstance,
  deps: RouteDeps,
): Promise<void> {
  app.get("/slicer-instances", async () => ({
    instances: deps.repo.listSlicerInstances().map(asInstanceJson),
  }));

  app.post("/slicer-instances/seed-defaults", async () => {
    const inserted = deps.repo.seedStockSlicerInstancesIfEmpty();
    return {
      inserted,
      instances: deps.repo.listSlicerInstances().map(asInstanceJson),
    };
  });

  app.post("/slicer-instances", async (request, reply) => {
    const body = (request.body ?? {}) as Record<string, unknown>;
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const kind = parseKind(body.kind);
    if (!name) return reply.status(400).send({ detail: "name is required" });
    if (!kind) return reply.status(400).send({ detail: "invalid kind" });

    const dialect =
      parseDialect(body.dialect) ?? (kind === "custom" ? null : defaultDialectForKind(kind));
    if (!dialect) return reply.status(400).send({ detail: "invalid or missing dialect" });

    const guiUrl = typeof body.gui_url === "string" ? body.gui_url.trim() : "";
    const watchPath = typeof body.watch_path === "string" ? body.watch_path.trim() : "";
    const enabled = body.enabled === undefined ? true : Boolean(body.enabled);

    const err = validateWritable({ kind, dialect, watchPath, enabled });
    if (err) return reply.status(400).send({ detail: err });

    const row = deps.repo.upsertSlicerInstance({
      name,
      kind,
      dialect,
      guiUrl,
      watchPath,
      enabled,
    });
    return reply.status(201).send(asInstanceJson(row));
  });

  app.put("/slicer-instances/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const existing = deps.repo.getSlicerInstance(id);
    if (!existing) return reply.status(404).send({ detail: "Slicer instance not found" });

    const body = (request.body ?? {}) as Record<string, unknown>;
    const name =
      typeof body.name === "string" ? body.name.trim() : existing.name;
    if (!name) return reply.status(400).send({ detail: "name is required" });

    const kind = body.kind !== undefined ? parseKind(body.kind) : (existing.kind as SlicerInstanceKind);
    if (!kind) return reply.status(400).send({ detail: "invalid kind" });

    const dialect =
      body.dialect !== undefined
        ? parseDialect(body.dialect)
        : (existing.dialect as SlicerDialect);
    if (!dialect) return reply.status(400).send({ detail: "invalid dialect" });

    const guiUrl =
      typeof body.gui_url === "string" ? body.gui_url.trim() : existing.guiUrl;
    const watchPath =
      typeof body.watch_path === "string" ? body.watch_path.trim() : existing.watchPath;
    const enabled =
      body.enabled === undefined ? existing.enabled : Boolean(body.enabled);

    const err = validateWritable({ kind, dialect, watchPath, enabled });
    if (err) return reply.status(400).send({ detail: err });

    const row = deps.repo.upsertSlicerInstance({
      id,
      name,
      kind,
      dialect,
      guiUrl,
      watchPath,
      enabled,
    });
    return asInstanceJson(row);
  });

  app.delete("/slicer-instances/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    if (!deps.repo.deleteSlicerInstance(id)) {
      return reply.status(404).send({ detail: "Slicer instance not found" });
    }
    return reply.status(204).send();
  });
}
