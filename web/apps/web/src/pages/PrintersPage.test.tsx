// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import PrintersPage from "./PrintersPage";

const api = vi.hoisted(() => ({
  fetchPrinters: vi.fn(),
  fetchIntegrations: vi.fn(),
  fetchPrinterCheckoffLinks: vi.fn(),
  fetchIntegrationStatus: vi.fn(),
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

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

beforeEach(() => {
  api.fetchIntegrations.mockResolvedValue([]);
  api.fetchPrinterCheckoffLinks.mockResolvedValue({ links: [] });
  api.fetchIntegrationStatus.mockResolvedValue({ state: "offline" });
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

    expect(await screen.findByText("Shop Voron")).toBeTruthy();
    expect(screen.getByText("Planning only")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Add connection" })).toBeTruthy();
    expect(screen.queryByText("No printers")).toBeNull();
  });
});
