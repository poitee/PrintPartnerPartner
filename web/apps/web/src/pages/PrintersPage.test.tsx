// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import PrintersPage from "./PrintersPage";

const api = vi.hoisted(() => ({
  addPrinter: vi.fn(),
  createIntegration: vi.fn(),
  deleteIntegration: vi.fn(),
  deletePrinter: vi.fn(),
  fetchFilamentCatalog: vi.fn(),
  fetchIntegrationStatus: vi.fn(),
  fetchIntegrations: vi.fn(),
  fetchPrinterCheckoffLinks: vi.fn(),
  fetchPrinterPlanBindings: vi.fn(),
  fetchPrinterPresets: vi.fn(),
  fetchPrinters: vi.fn(),
  fetchProfiles: vi.fn(),
  savePrinterFleet: vi.fn(),
  savePrinterPlanBinding: vi.fn(),
  testIntegration: vi.fn(),
  updateIntegration: vi.fn(),
  updatePrinterSlicer: vi.fn(),
}));

vi.mock("../hooks/useEngineHealth", () => ({
  useEngineHealth: () => ({ health: { ok: true }, error: null, loading: false }),
}));
vi.mock("../context/ProfileContext", () => ({
  useProfileSelection: () => ({ profiles: [], selectedProfileId: null }),
}));
vi.mock("../hooks/usePrinterStatusPollMs", () => ({
  usePrinterStatusPollMs: () => 60_000,
}));
vi.mock("../api/engine", () => api);
vi.mock("../components/settings/PrinterProfileAssignmentSection", () => ({ default: () => null }));
vi.mock("../components/settings/SlotFilamentPicker", () => ({ default: () => null }));

const voronPreset = {
  id: "preset-voron-250",
  name: "Voron 250",
  model_slug: "voron-250",
  bed_width_mm: 250,
  bed_depth_mm: 250,
  bed_height_mm: 250,
  max_filament_slots: 1,
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

beforeEach(() => {
  api.fetchPrinters.mockResolvedValue([]);
  api.fetchPrinterPresets.mockResolvedValue([voronPreset]);
  api.fetchIntegrations.mockResolvedValue([]);
  api.fetchPrinterCheckoffLinks.mockResolvedValue({ links: [] });
  api.fetchPrinterPlanBindings.mockResolvedValue([]);
  api.fetchProfiles.mockResolvedValue([]);
  api.fetchFilamentCatalog.mockResolvedValue(null);
  api.fetchIntegrationStatus.mockResolvedValue({ state: "offline" });
  api.addPrinter.mockResolvedValue({
    id: "printer-plan",
    name: "Desk Voron",
    model: "voron-250",
    bed_width_mm: 250,
    bed_depth_mm: 250,
    bed_height_mm: 250,
    margin_mm: 4,
    max_filament_slots: 1,
    loaded_filaments: [],
    integration_id: null,
    preset_id: "preset-voron-250",
  });
});

describe("PrintersPage", () => {
  it("shows a planning Printer that has no connection", async () => {
    api.fetchPrinters.mockResolvedValue([
      {
        id: "printer-plan",
        name: "Shop Voron",
        model: "voron-250",
        bed_width_mm: 250,
        bed_depth_mm: 250,
        bed_height_mm: 250,
        margin_mm: 4,
        max_filament_slots: 1,
        loaded_filaments: [],
        integration_id: null,
      },
    ]);

    render(
      <MemoryRouter>
        <PrintersPage />
      </MemoryRouter>,
    );

    expect(await screen.findByText("Planning only")).toBeTruthy();
    expect(screen.getAllByText("Shop Voron").length).toBeGreaterThan(0);
    expect(screen.getByRole("link", { name: "Add connection" })).toBeTruthy();
    expect(screen.queryByText("No printers")).toBeNull();
  });

  it("creates a planning Printer on this page without a connection", async () => {
    const created = {
      id: "printer-plan",
      name: "Desk Voron",
      model: "voron-250",
      bed_width_mm: 250,
      bed_depth_mm: 250,
      bed_height_mm: 250,
      margin_mm: 4,
      max_filament_slots: 1,
      loaded_filaments: [],
      integration_id: null,
      preset_id: "preset-voron-250",
    };
    api.addPrinter.mockResolvedValue(created);
    api.fetchPrinters.mockImplementation(async () =>
      api.addPrinter.mock.calls.length ? [created] : [],
    );

    render(
      <MemoryRouter>
        <PrintersPage />
      </MemoryRouter>,
    );

    const name = await screen.findByPlaceholderText("Shop Voron");
    fireEvent.change(name, { target: { value: "Desk Voron" } });
    fireEvent.click(screen.getByRole("button", { name: "Add printer" }));

    await waitFor(() => {
      expect(api.addPrinter).toHaveBeenCalledWith({
        name: "Desk Voron",
        preset_id: "preset-voron-250",
      });
    });
    expect(api.createIntegration).not.toHaveBeenCalled();
    expect(screen.queryByRole("link", { name: "Add printer" })).toBeNull();
    expect(await screen.findByText("Planning only")).toBeTruthy();
    expect(screen.getAllByText("Desk Voron").length).toBeGreaterThan(0);
  });
});
