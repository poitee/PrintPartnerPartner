import type { SlicerInstanceRow } from "../db/repository.js";

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
