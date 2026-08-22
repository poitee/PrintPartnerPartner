// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import PrinterSendPanel from "./PrinterSendPanel";

const api = vi.hoisted(() => ({
  fetchIntegrationStatus: vi.fn(),
  fetchIntegrations: vi.fn(),
  fetchPrinters: vi.fn(),
  startBambuConnectHandoff: vi.fn(),
  startPrinterUpload: vi.fn(),
}));

vi.mock("../../hooks/useJobRunner", () => ({
  useJobRunner: () => ({
    busy: false,
    isBusyForSource: () => false,
    message: "",
    runJob: vi.fn(),
  }),
}));
vi.mock("../../hooks/usePrinterStatusPollMs", () => ({
  usePrinterStatusPollMs: () => 60_000,
}));
vi.mock("../../api/engine", () => api);

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

beforeEach(() => {
  api.fetchIntegrationStatus.mockResolvedValue({ state: "idle" });
  api.fetchIntegrations.mockResolvedValue([]);
  api.fetchPrinters.mockResolvedValue([]);
});

describe("PrinterSendPanel", () => {
  it("hides Send for a Bambu-only fleet and offers Connect instead", async () => {
    api.fetchPrinters.mockResolvedValue([
      {
        id: "printer-x1",
        name: "Desk X1C",
        model: "X1C",
        bed_width_mm: 256,
        bed_depth_mm: 256,
        bed_height_mm: 256,
        margin_mm: 4,
        max_filament_slots: 4,
        loaded_filaments: [],
        integration_id: "int-bambu",
      },
    ]);
    api.fetchIntegrations.mockResolvedValue([
      {
        id: "int-bambu",
        type: "bambu",
        name: "Desk X1C",
        config: { enabled: true, host: "192.168.1.60" },
      },
    ]);

    render(
      <MemoryRouter>
        <PrinterSendPanel remainingParts={[]} profileId={7} planName="Voron" engineReady />
      </MemoryRouter>,
    );

    expect(await screen.findByRole("button", { name: "Open in Bambu Connect" })).toBeTruthy();
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "Send" })).toBeNull();
      expect(screen.queryByRole("button", { name: "Start print" })).toBeNull();
    });
  });
});
