// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import PrintersSettingsCard from "./PrintersSettingsCard";

const api = vi.hoisted(() => ({
  addPrinter: vi.fn(),
  createIntegration: vi.fn(),
  deleteIntegration: vi.fn(),
  deletePrinter: vi.fn(),
  fetchIntegrationStatus: vi.fn(),
  fetchIntegrations: vi.fn(),
  fetchPrinterPlanBindings: vi.fn(),
  fetchPrinterPresets: vi.fn(),
  fetchFilamentCatalog: vi.fn(),
  fetchPrinters: vi.fn(),
  fetchProfiles: vi.fn(),
  savePrinterFleet: vi.fn(),
  savePrinterPlanBinding: vi.fn(),
  testIntegration: vi.fn(),
  updateIntegration: vi.fn(),
  updatePrinterSlicer: vi.fn(),
}));

vi.mock("../../api/engine", () => api);
vi.mock("./PrinterProfileAssignmentSection", () => ({ default: () => null }));
vi.mock("./SlotFilamentPicker", () => ({ default: () => null }));

const voronPreset = {
  id: "preset-voron-250",
  name: "Voron 250",
  model_slug: "voron-250",
  bed_width_mm: 250,
  bed_depth_mm: 250,
  bed_height_mm: 250,
  max_filament_slots: 1,
};

const planningPrinter = {
  id: "printer-plan",
  name: "Shop Voron",
  model: "voron-250",
  bed_width_mm: 250,
  bed_depth_mm: 250,
  bed_height_mm: 250,
  margin_mm: 4,
  max_filament_slots: 1,
  loaded_filaments: [{ slot: 1, filament_color_id: null, label: "" }],
  integration_id: null,
  device_id: null,
  preset_id: "preset-voron-250",
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

beforeEach(() => {
  api.fetchPrinters.mockResolvedValue([]);
  api.fetchPrinterPresets.mockResolvedValue([voronPreset]);
  api.fetchIntegrations.mockResolvedValue([]);
  api.fetchPrinterPlanBindings.mockResolvedValue([]);
  api.fetchProfiles.mockResolvedValue([]);
  api.fetchFilamentCatalog.mockResolvedValue(null);
  api.fetchIntegrationStatus.mockResolvedValue({ state: "offline" });
  api.addPrinter.mockImplementation(async (body: { name: string; preset_id?: string }) => ({
    ...planningPrinter,
    name: body.name,
    preset_id: body.preset_id ?? null,
  }));
  api.savePrinterFleet.mockImplementation(async (fleet: unknown) => fleet);
  api.createIntegration.mockResolvedValue({
    id: "int-moon",
    type: "moonraker",
    name: "Shop Voron",
    config: { enabled: true, base_url: "http://192.168.1.40:7125" },
  });
});

describe("PrintersSettingsCard", () => {
  it("creates a planning Printer from a preset without a connection", async () => {
    render(<PrintersSettingsCard engineReady />);

    const name = await screen.findByPlaceholderText("Shop Voron");
    await screen.findByText(/Voron 250/);
    fireEvent.change(name, { target: { value: "Shop Voron" } });
    fireEvent.click(screen.getByRole("button", { name: "Add printer" }));

    await waitFor(() => {
      expect(api.addPrinter).toHaveBeenCalledWith({
        name: "Shop Voron",
        preset_id: "preset-voron-250",
      });
    });
    expect(api.createIntegration).not.toHaveBeenCalled();
    expect(api.savePrinterFleet).not.toHaveBeenCalled();
    expect(
      await screen.findByText(
        "Shop Voron added for planning and local 3MF. Add a connection later to send jobs and read status.",
      ),
    ).toBeTruthy();
  });

  it("attaches a host later to a planning Printer", async () => {
    api.fetchPrinters.mockResolvedValue([planningPrinter]);
    render(<PrintersSettingsCard engineReady />);

    fireEvent.click(await screen.findByRole("button", { name: "Add connection" }));
    fireEvent.click(screen.getByRole("button", { name: "Save connection" }));

    await waitFor(() => {
      expect(api.createIntegration).toHaveBeenCalledWith({
        type: "moonraker",
        name: "Shop Voron",
        config: { base_url: "http://192.168.1.40:7125", enabled: true },
      });
    });
    await waitFor(() => {
      expect(api.savePrinterFleet).toHaveBeenCalledWith([
        expect.objectContaining({
          id: "printer-plan",
          integration_id: "int-moon",
          device_id: "default",
        }),
      ]);
    });
  });

  it("edits a planning Printer's model and bed size without a connection", async () => {
    api.fetchPrinters.mockResolvedValue([planningPrinter]);
    render(<PrintersSettingsCard engineReady />);

    fireEvent.click(await screen.findByRole("button", { name: "Edit size" }));
    fireEvent.change(screen.getByLabelText("Model"), { target: { value: "Voron 300" } });
    fireEvent.change(screen.getByLabelText("Width (mm)"), { target: { value: "300" } });
    fireEvent.change(screen.getByLabelText("Depth (mm)"), { target: { value: "300" } });
    fireEvent.change(screen.getByLabelText("Height (mm)"), { target: { value: "320" } });
    fireEvent.click(screen.getByRole("button", { name: "Save size" }));

    await waitFor(() => {
      expect(api.savePrinterFleet).toHaveBeenCalledWith([
        expect.objectContaining({
          id: "printer-plan",
          model: "Voron 300",
          bed_width_mm: 300,
          bed_depth_mm: 300,
          bed_height_mm: 320,
          preset_id: "preset-voron-250",
          integration_id: null,
        }),
      ]);
    });
    expect(api.createIntegration).not.toHaveBeenCalled();
  });
});
