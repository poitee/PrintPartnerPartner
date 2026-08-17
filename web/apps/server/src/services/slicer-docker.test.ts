import { describe, expect, it } from "vitest";
import {
  createFakeDockerAdapter,
  parseEnvJson,
  parsePortsJson,
  parseVolumesJson,
  SLICER_INSTANCE_LABEL,
  specFromInstanceRow,
  type SlicerContainerSpec,
} from "./slicer-docker.js";
import type { SlicerInstanceRow } from "../db/repository.js";

const baseSpec: SlicerContainerSpec = {
  instanceId: "slicer-1",
  name: "Orca",
  image: "lscr.io/linuxserver/orcaslicer:latest",
  containerName: "orcaslicer",
  dockerTarget: "local",
  ports: [],
  volumes: [],
  env: {},
};

describe("slicer docker helpers", () => {
  it("exports the ownership label", () => {
    expect(SLICER_INSTANCE_LABEL).toBe("printpartner.slicer_instance_id");
  });

  it("parses ports, volumes, and env JSON safely", () => {
    expect(
      parsePortsJson('[{"host":3010,"container":3000,"protocol":"tcp"}]'),
    ).toEqual([{ host: 3010, container: 3000, protocol: "tcp" }]);
    expect(parsePortsJson("nope")).toEqual([]);
    expect(parseVolumesJson('[{"host":"orca-config","container":"/config"}]')).toEqual([
      { host: "orca-config", container: "/config", mode: "rw" },
    ]);
    expect(parseEnvJson('{"PUID":"1000","n":1}')).toEqual({ PUID: "1000", n: "1" });
  });

  it("builds a container spec from an instance row", () => {
    const row = {
      id: "slicer-abc",
      name: "Orca",
      kind: "orca",
      dialect: "orca_json",
      guiUrl: "http://orca.home",
      watchPath: "/slicer-profiles/orca",
      dockerTarget: "local",
      dockerHost: null,
      composeService: null,
      image: "lscr.io/linuxserver/orcaslicer:latest",
      containerName: "orcaslicer",
      portsJson: '[{"host":3010,"container":3000}]',
      volumesJson: "[]",
      envJson: "{}",
      statusCache: "unknown",
      statusMessage: null,
      enabled: true,
      createdAt: "t",
      updatedAt: "t",
    } satisfies SlicerInstanceRow;
    const spec = specFromInstanceRow(row);
    expect(spec.instanceId).toBe("slicer-abc");
    expect(spec.ports[0]).toMatchObject({ host: 3010, container: 3000 });
  });
});

describe("createFakeDockerAdapter", () => {
  it("creates a labeled container on start and reports running", async () => {
    const docker = createFakeDockerAdapter();
    const status = await docker.start(baseSpec);
    expect(status.state).toBe("running");
    expect(status.containerId).toBeTruthy();
    expect(await docker.refreshStatus(baseSpec)).toMatchObject({ state: "running" });
  });

  it("refuses to start when container name is owned by another instance", async () => {
    const docker = createFakeDockerAdapter([
      {
        id: "c1",
        name: "orcaslicer",
        image: "other",
        labels: { [SLICER_INSTANCE_LABEL]: "someone-else" },
        state: "stopped",
        logs: [],
      },
    ]);
    const status = await docker.start(baseSpec);
    expect(status.state).toBe("error");
    expect(status.message).toMatch(/not labeled/i);
  });

  it("stops and returns logs", async () => {
    const docker = createFakeDockerAdapter();
    await docker.start(baseSpec);
    await docker.stop(baseSpec);
    expect(await docker.refreshStatus(baseSpec)).toMatchObject({ state: "stopped" });
    const { lines } = await docker.logs(baseSpec, { tail: 10 });
    expect(lines.some((l) => l.includes("started"))).toBe(true);
    expect(lines.some((l) => l.includes("stopped"))).toBe(true);
  });
});
