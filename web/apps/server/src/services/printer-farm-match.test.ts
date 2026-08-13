import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PrinterSendQueueItem } from "@print-partner/contracts";
import type { PrinterMachine } from "@print-partner/domain";
import type { AppRepository } from "../db/repository.js";

vi.mock("../integrations/store.js", () => ({
  getIntegrationConfig: vi.fn(),
}));

import { getIntegrationConfig } from "../integrations/store.js";
import {
  listCompatibleSendPrinters,
  rankCompatibleSendPrinters,
  wantedFilamentIdsForQueueItem,
} from "./printer-farm-match.js";

const getIntegrationConfigMock = vi.mocked(getIntegrationConfig);

function machine(
  partial: Partial<PrinterMachine> & Pick<PrinterMachine, "id" | "name">,
): PrinterMachine {
  return {
    bed_width_mm: 250,
    bed_depth_mm: 250,
    bed_height_mm: 250,
    margin_mm: 5,
    max_filament_slots: 1,
    loaded_filaments: [{ slot: 1, filament_color_id: null, label: "" }],
    integration_id: `int-${partial.id}`,
    ...partial,
  };
}

function fakeRepo(parts: Array<{ id: number; filament_color_id?: string | null }> = []): AppRepository {
  return {
    listParts: () => ({ parts, total: parts.length }),
  } as unknown as AppRepository;
}

function queueItem(
  partial: Partial<PrinterSendQueueItem> = {},
): PrinterSendQueueItem {
  return {
    id: "q1",
    filename: "a.gcode",
    artifact_path: "/x",
    printer_id: "pref",
    match: "compatible",
    wait_for_idle: true,
    start: true,
    state: "queued",
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    ...partial,
  };
}

describe("printer-farm-match", () => {
  beforeEach(() => {
    getIntegrationConfigMock.mockReset();
    getIntegrationConfigMock.mockImplementation((_repo, id) => {
      if (!id.startsWith("int-")) return null;
      if (id === "int-bambu") {
        return { id, type: "bambu", name: "Bambu" } as ReturnType<typeof getIntegrationConfig>;
      }
      return {
        id,
        type: id.includes("prusa") ? "prusalink" : "moonraker",
        name: id,
      } as ReturnType<typeof getIntegrationConfig>;
    });
  });

  it("wantedFilamentIdsForQueueItem collects ids from Progress units", () => {
    const repo = fakeRepo([
      { id: 1, filament_color_id: "red" },
      { id: 2, filament_color_id: "blue" },
      { id: 3, filament_color_id: null },
    ]);
    const ids = wantedFilamentIdsForQueueItem(
      repo,
      queueItem({
        profile_id: 9,
        checkoff_units: [
          { part_id: 1, unit_index: 0 },
          { part_id: 2, unit_index: 0 },
          { part_id: 3, unit_index: 0 },
        ],
      }),
    );
    expect([...ids].sort()).toEqual(["blue", "red"]);
  });

  it("listCompatibleSendPrinters keeps same-bed Moonraker/PrusaLink only", () => {
    const repo = fakeRepo();
    const preferred = machine({ id: "pref", name: "Preferred" });
    const twin = machine({ id: "twin", name: "Twin" });
    const mini = machine({
      id: "mini",
      name: "Mini",
      bed_width_mm: 180,
      bed_depth_mm: 180,
    });
    const bambu = machine({
      id: "bambu",
      name: "Bambu",
      integration_id: "int-bambu",
    });
    const unbound = machine({
      id: "free",
      name: "Unbound",
      integration_id: null,
    });
    const list = listCompatibleSendPrinters(repo, preferred, [
      preferred,
      twin,
      mini,
      bambu,
      unbound,
    ]);
    expect(list.map((p) => p.id).sort()).toEqual(["pref", "twin"]);
  });

  it("rankCompatibleSendPrinters prefers filament overlap then preferred id", () => {
    const repo = fakeRepo([
      { id: 1, filament_color_id: "red" },
      { id: 2, filament_color_id: "blue" },
    ]);
    const preferred = machine({
      id: "pref",
      name: "Preferred",
      loaded_filaments: [{ slot: 1, filament_color_id: "red", label: "Red" }],
    });
    const better = machine({
      id: "better",
      name: "Better",
      max_filament_slots: 2,
      loaded_filaments: [
        { slot: 1, filament_color_id: "red", label: "Red" },
        { slot: 2, filament_color_id: "blue", label: "Blue" },
      ],
    });
    const ranked = rankCompatibleSendPrinters(
      repo,
      queueItem({
        profile_id: 9,
        checkoff_units: [
          { part_id: 1, unit_index: 0 },
          { part_id: 2, unit_index: 0 },
        ],
      }),
      preferred,
      [preferred, better],
    );
    expect(ranked.map((r) => r.printer.id)).toEqual(["better", "pref"]);
    expect(ranked[0]?.score).toBe(2);
    expect(ranked[1]?.score).toBe(1);
  });

  it("rankCompatibleSendPrinters excludes already-used printers", () => {
    const repo = fakeRepo();
    const preferred = machine({ id: "pref", name: "Preferred" });
    const twin = machine({ id: "twin", name: "Twin" });
    const ranked = rankCompatibleSendPrinters(
      repo,
      queueItem(),
      preferred,
      [preferred, twin],
      { excludePrinterIds: new Set(["pref"]) },
    );
    expect(ranked.map((r) => r.printer.id)).toEqual(["twin"]);
  });
});
