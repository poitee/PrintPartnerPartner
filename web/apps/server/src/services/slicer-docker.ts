import type { SlicerInstanceRow } from "../db/repository.js";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

export const SLICER_INSTANCE_LABEL = "printpartner.slicer_instance_id";

export type DockerTarget = "local" | "pp_compose" | "remote";

export type SlicerPortMapping = {
  host: number;
  container: number;
  protocol?: "tcp" | "udp";
};

export type SlicerVolumeMapping = {
  host: string;
  container: string;
  mode?: "ro" | "rw";
};

export type SlicerContainerSpec = {
  instanceId: string;
  name: string;
  image: string;
  containerName: string;
  dockerTarget: DockerTarget;
  dockerHost?: string | null;
  composeService?: string | null;
  ports: SlicerPortMapping[];
  volumes: SlicerVolumeMapping[];
  env: Record<string, string>;
};

export type SlicerDockerStatus = {
  state: "running" | "stopped" | "unknown" | "error" | "missing";
  message: string | null;
  containerId: string | null;
};

export type SlicerDockerAdapter = {
  refreshStatus(spec: SlicerContainerSpec): Promise<SlicerDockerStatus>;
  pull(spec: SlicerContainerSpec): Promise<SlicerDockerStatus>;
  start(spec: SlicerContainerSpec): Promise<SlicerDockerStatus>;
  stop(spec: SlicerContainerSpec): Promise<SlicerDockerStatus>;
  logs(spec: SlicerContainerSpec, opts?: { tail?: number }): Promise<{ lines: string[] }>;
};

export function parsePortsJson(raw: string | null | undefined): SlicerPortMapping[] {
  if (!raw?.trim()) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((entry) => {
      if (!entry || typeof entry !== "object") return [];
      const row = entry as Record<string, unknown>;
      const host = Number(row.host);
      const container = Number(row.container);
      if (!Number.isFinite(host) || !Number.isFinite(container)) return [];
      const protocol = row.protocol === "udp" ? "udp" : "tcp";
      return [{ host, container, protocol }];
    });
  } catch {
    return [];
  }
}

export function parseVolumesJson(raw: string | null | undefined): SlicerVolumeMapping[] {
  if (!raw?.trim()) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((entry) => {
      if (!entry || typeof entry !== "object") return [];
      const row = entry as Record<string, unknown>;
      const host = typeof row.host === "string" ? row.host.trim() : "";
      const container = typeof row.container === "string" ? row.container.trim() : "";
      if (!host || !container) return [];
      const mode = row.mode === "ro" ? "ro" : "rw";
      return [{ host, container, mode }];
    });
  } catch {
    return [];
  }
}

export function parseEnvJson(raw: string | null | undefined): Record<string, string> {
  if (!raw?.trim()) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value === "string") out[key] = value;
      else if (typeof value === "number" || typeof value === "boolean") out[key] = String(value);
    }
    return out;
  } catch {
    return {};
  }
}

function asDockerTarget(value: string): DockerTarget {
  if (value === "pp_compose" || value === "remote") return value;
  return "local";
}

export function specFromInstanceRow(row: SlicerInstanceRow): SlicerContainerSpec {
  return {
    instanceId: row.id,
    name: row.name,
    image: row.image?.trim() || "",
    containerName: row.containerName?.trim() || `pp-slicer-${row.id}`,
    dockerTarget: asDockerTarget(row.dockerTarget),
    dockerHost: row.dockerHost,
    composeService: row.composeService,
    ports: parsePortsJson(row.portsJson),
    volumes: parseVolumesJson(row.volumesJson),
    env: parseEnvJson(row.envJson),
  };
}

type FakeContainer = {
  id: string;
  name: string;
  image: string;
  labels: Record<string, string>;
  state: "running" | "stopped";
  logs: string[];
};

/** In-memory adapter for tests — enforces label ownership like the real Engine path. */
export function createFakeDockerAdapter(seed: FakeContainer[] = []): SlicerDockerAdapter {
  const containers = new Map<string, FakeContainer>(seed.map((c) => [c.id, { ...c, labels: { ...c.labels } }]));
  let seq = seed.length;

  function findByInstance(instanceId: string): FakeContainer | null {
    for (const c of containers.values()) {
      if (c.labels[SLICER_INSTANCE_LABEL] === instanceId) return c;
    }
    return null;
  }

  function findByName(name: string): FakeContainer | null {
    for (const c of containers.values()) {
      if (c.name === name) return c;
    }
    return null;
  }

  async function refreshStatus(spec: SlicerContainerSpec): Promise<SlicerDockerStatus> {
    const byName = findByName(spec.containerName);
    if (byName && byName.labels[SLICER_INSTANCE_LABEL] !== spec.instanceId) {
      return {
        state: "error",
        message: `Container ${spec.containerName} is not labeled for this slicer instance`,
        containerId: byName.id,
      };
    }
    const owned = findByInstance(spec.instanceId);
    if (!owned) {
      return { state: "missing", message: "Container not found", containerId: null };
    }
    return {
      state: owned.state,
      message: null,
      containerId: owned.id,
    };
  }

  return {
    refreshStatus,
    async pull(spec) {
      if (!spec.image.trim()) {
        return { state: "error", message: "image is required", containerId: null };
      }
      return refreshStatus(spec);
    },
    async start(spec) {
      if (!spec.image.trim()) {
        return { state: "error", message: "image is required", containerId: null };
      }
      const conflict = findByName(spec.containerName);
      if (conflict && conflict.labels[SLICER_INSTANCE_LABEL] !== spec.instanceId) {
        return {
          state: "error",
          message: `Container ${spec.containerName} is not labeled for this slicer instance`,
          containerId: conflict.id,
        };
      }
      let owned = findByInstance(spec.instanceId);
      if (!owned) {
        seq += 1;
        owned = {
          id: `fake-${seq}`,
          name: spec.containerName,
          image: spec.image,
          labels: { [SLICER_INSTANCE_LABEL]: spec.instanceId },
          state: "stopped",
          logs: [],
        };
        containers.set(owned.id, owned);
      }
      owned.state = "running";
      owned.logs.push(`started ${spec.image}`);
      return refreshStatus(spec);
    },
    async stop(spec) {
      const owned = findByInstance(spec.instanceId);
      if (!owned) {
        return { state: "missing", message: "Container not found", containerId: null };
      }
      owned.state = "stopped";
      owned.logs.push("stopped");
      return refreshStatus(spec);
    },
    async logs(spec, opts) {
      const owned = findByInstance(spec.instanceId);
      if (!owned) return { lines: [] };
      const tail = Math.min(Math.max(opts?.tail ?? 200, 1), 500);
      return { lines: owned.logs.slice(-tail) };
    },
  };
}

type DockerodeLike = {
  listContainers: (opts?: {
    all?: boolean;
    filters?: string;
  }) => Promise<Array<{ Id: string; Names?: string[]; Labels?: Record<string, string>; State?: string }>>;
  getContainer: (id: string) => {
    inspect: () => Promise<{
      Id: string;
      Name?: string;
      State?: { Running?: boolean; Status?: string };
      Config?: { Labels?: Record<string, string> };
    }>;
    start: () => Promise<void>;
    stop: (opts?: { t?: number }) => Promise<void>;
    logs: (opts: {
      stdout?: boolean;
      stderr?: boolean;
      tail?: number;
    }) => Promise<Buffer | NodeJS.ReadableStream>;
  };
  createContainer: (opts: Record<string, unknown>) => Promise<{ id: string; start: () => Promise<void> }>;
  pull: (
    image: string,
    cb: (err: Error | null, stream: NodeJS.ReadableStream) => void,
  ) => void;
  modem: {
    followProgress: (
      stream: NodeJS.ReadableStream,
      onFinished: (err: Error | null) => void,
    ) => void;
  };
};

export type EngineDockerFactory = (dockerHost?: string | null) => DockerodeLike;

function defaultEngineFactory(dockerHost?: string | null): DockerodeLike {
  const Docker = require("dockerode") as new (opts?: {
    socketPath?: string;
    host?: string;
  }) => DockerodeLike;
  const host = dockerHost?.trim();
  if (!host) return new Docker({ socketPath: process.env.DOCKER_SOCKET || "/var/run/docker.sock" });
  if (host.startsWith("unix://")) return new Docker({ socketPath: host.replace("unix://", "") });
  return new Docker({ host });
}

async function bufferLogs(raw: Buffer | NodeJS.ReadableStream): Promise<string> {
  if (Buffer.isBuffer(raw)) return raw.toString("utf8");
  const chunks: Buffer[] = [];
  for await (const chunk of raw as AsyncIterable<Buffer | string>) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

function portBindings(spec: SlicerContainerSpec): Record<string, Array<{ HostPort: string }>> {
  const bindings: Record<string, Array<{ HostPort: string }>> = {};
  for (const port of spec.ports) {
    const protocol = port.protocol ?? "tcp";
    const key = `${port.container}/${protocol}`;
    bindings[key] = [{ HostPort: String(port.host) }];
  }
  return bindings;
}

function binds(spec: SlicerContainerSpec): string[] {
  return spec.volumes.map((v) => `${v.host}:${v.container}:${v.mode ?? "rw"}`);
}

export function createEngineDockerAdapter(
  dockerHost?: string | null,
  factory: EngineDockerFactory = defaultEngineFactory,
): SlicerDockerAdapter {
  const docker = factory(dockerHost);

  async function findOwned(spec: SlicerContainerSpec) {
    const filters = JSON.stringify({ label: [`${SLICER_INSTANCE_LABEL}=${spec.instanceId}`] });
    const listed = await docker.listContainers({ all: true, filters });
    if (listed.length > 0) return listed[0]!;

    const byName = (await docker.listContainers({ all: true })).find((c) =>
      (c.Names ?? []).some((n) => n === `/${spec.containerName}` || n === spec.containerName),
    );
    if (byName) {
      const label = byName.Labels?.[SLICER_INSTANCE_LABEL];
      if (label !== spec.instanceId) {
        return { conflict: byName as (typeof listed)[0] };
      }
    }
    return null;
  }

  async function refreshStatus(spec: SlicerContainerSpec): Promise<SlicerDockerStatus> {
    try {
      const found = await findOwned(spec);
      if (found && "conflict" in found) {
        return {
          state: "error",
          message: `Container ${spec.containerName} is not labeled for this slicer instance`,
          containerId: found.conflict.Id,
        };
      }
      if (!found) {
        return { state: "missing", message: "Container not found", containerId: null };
      }
      const running = found.State === "running";
      return {
        state: running ? "running" : "stopped",
        message: null,
        containerId: found.Id,
      };
    } catch (e) {
      return {
        state: "error",
        message: e instanceof Error ? e.message : String(e),
        containerId: null,
      };
    }
  }

  return {
    refreshStatus,
    async pull(spec) {
      if (!spec.image.trim()) {
        return { state: "error", message: "image is required", containerId: null };
      }
      try {
        await new Promise<void>((resolve, reject) => {
          docker.pull(spec.image, (err, stream) => {
            if (err) return reject(err);
            docker.modem.followProgress(stream, (finishedErr) => {
              if (finishedErr) reject(finishedErr);
              else resolve();
            });
          });
        });
        return refreshStatus(spec);
      } catch (e) {
        return {
          state: "error",
          message: e instanceof Error ? e.message : String(e),
          containerId: null,
        };
      }
    },
    async start(spec) {
      if (!spec.image.trim()) {
        return { state: "error", message: "image is required", containerId: null };
      }
      try {
        const found = await findOwned(spec);
        if (found && "conflict" in found) {
          return {
            state: "error",
            message: `Container ${spec.containerName} is not labeled for this slicer instance`,
            containerId: found.conflict.Id,
          };
        }
        if (found) {
          if (found.State !== "running") {
            await docker.getContainer(found.Id).start();
          }
          return refreshStatus(spec);
        }
        const created = await docker.createContainer({
          Image: spec.image,
          name: spec.containerName,
          Env: Object.entries(spec.env).map(([k, v]) => `${k}=${v}`),
          Labels: { [SLICER_INSTANCE_LABEL]: spec.instanceId },
          HostConfig: {
            PortBindings: portBindings(spec),
            Binds: binds(spec),
            RestartPolicy: { Name: "unless-stopped" },
          },
        });
        await created.start();
        return refreshStatus(spec);
      } catch (e) {
        return {
          state: "error",
          message: e instanceof Error ? e.message : String(e),
          containerId: null,
        };
      }
    },
    async stop(spec) {
      try {
        const found = await findOwned(spec);
        if (found && "conflict" in found) {
          return {
            state: "error",
            message: `Container ${spec.containerName} is not labeled for this slicer instance`,
            containerId: found.conflict.Id,
          };
        }
        if (!found) {
          return { state: "missing", message: "Container not found", containerId: null };
        }
        if (found.State === "running") {
          await docker.getContainer(found.Id).stop({ t: 10 });
        }
        return refreshStatus(spec);
      } catch (e) {
        return {
          state: "error",
          message: e instanceof Error ? e.message : String(e),
          containerId: null,
        };
      }
    },
    async logs(spec, opts) {
      const found = await findOwned(spec);
      if (!found || "conflict" in found) return { lines: [] };
      const tail = Math.min(Math.max(opts?.tail ?? 200, 1), 500);
      const raw = await docker.getContainer(found.Id).logs({
        stdout: true,
        stderr: true,
        tail,
      });
      const text = await bufferLogs(raw);
      const lines = text
        .split(/\r?\n/)
        .map((line) => line.replace(/[^\x20-\x7E]* /, "").trimEnd())
        .filter(Boolean);
      return { lines: lines.slice(-tail) };
    },
  };
}

export function createDockerAdapterForSpec(spec: SlicerContainerSpec): SlicerDockerAdapter {
  // pp_compose uses the same Engine API for lifecycle once containers exist;
  // compose CLI orchestration can be layered later without changing this contract.
  const host = spec.dockerTarget === "remote" ? spec.dockerHost : undefined;
  return createEngineDockerAdapter(host);
}
