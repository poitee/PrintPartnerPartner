import { describe, expect, it, vi } from "vitest";
import type { AppRepository } from "../db/repository.js";
import { getPrinterCheckoffLink } from "./printer-checkoff-store.js";

vi.mock("../integrations/store.js", () => ({
  getIntegrationConfig: vi.fn(),
}));
vi.mock("../integrations/registry.js", () => ({
  getIntegrationAdapter: vi.fn(),
}));
vi.mock("./printer-fleet.js", () => ({
  loadFleet: vi.fn(),
}));

import { getIntegrationConfig } from "../integrations/store.js";
import { getIntegrationAdapter } from "../integrations/registry.js";
import { loadFleet } from "./printer-fleet.js";
import { runPrinterUploadJob } from "./printer-upload-job.js";

const getIntegrationConfigMock = vi.mocked(getIntegrationConfig);
const getIntegrationAdapterMock = vi.mocked(getIntegrationAdapter);
const loadFleetMock = vi.mocked(loadFleet);

function memoryRepo(): AppRepository {
  const settings = new Map<string, string>();
  return {
    getSetting: (k: string) => settings.get(k) ?? null,
    setSetting: (k: string, v: string) => {
      settings.set(k, v);
    },
    transaction: <T>(fn: () => T) => fn(),
  } as unknown as AppRepository;
}

describe("printer-upload-job plate revision binding", () => {
  it("stamps plate_revision_id onto the created Printer job mapping", async () => {
    const repo = memoryRepo();
    loadFleetMock.mockReturnValue([
      {
        id: "p1",
        name: "P1",
        model: "P1",
        bed_width_mm: 250,
        bed_depth_mm: 250,
        bed_height_mm: 250,
        margin_mm: 5,
        max_filament_slots: 1,
        loaded_filaments: [],
        integration_id: "int-1",
      },
    ]);
    getIntegrationConfigMock.mockReturnValue({
      id: "int-1",
      type: "moonraker",
      name: "Host",
      config: { base_url: "http://127.0.0.1:7125" },
      created_at: "",
      updated_at: "",
    } as ReturnType<typeof getIntegrationConfig>);
    getIntegrationAdapterMock.mockReturnValue({
      type: "moonraker",
      uploadFile: async () => ({ ok: true, remote_path: "gcodes/plate.gcode", started: false }),
    } as unknown as ReturnType<typeof getIntegrationAdapter>);

    const result = await runPrinterUploadJob(
      repo,
      {
        printer_id: "p1",
        artifact_path: "/tmp/unused.gcode",
        filename: "plate.gcode",
        start: false,
        profile_id: 7,
        checkoff_units: [{ part_id: 11, unit_index: 0 }],
        plate_revision_id: 19,
      },
      () => {},
    );

    const linkId = result.checkoff_link_id;
    expect(typeof linkId).toBe("string");
    const link = getPrinterCheckoffLink(repo, String(linkId));
    expect(link?.plate_revision_id).toBe(19);
    expect(link?.units).toEqual([{ part_id: 11, unit_index: 0 }]);
  });
});
