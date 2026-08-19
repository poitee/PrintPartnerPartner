// @vitest-environment jsdom

import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import PrinterLiveStrip from "./PrinterLiveStrip";

const api = vi.hoisted(() => ({
  fetchPrinters: vi.fn(),
  fetchIntegrations: vi.fn(),
  reconcilePrinterCheckoff: vi.fn(),
  fetchIntegrationStatus: vi.fn(),
}));

vi.mock("../../api/engine", () => api);
vi.mock("../../hooks/usePrinterStatusPollMs", () => ({
  usePrinterStatusPollMs: () => 60_000,
}));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("PrinterLiveStrip", () => {
  it("notifies Progress when reconcile discovers a currently printing link", async () => {
    api.fetchPrinters.mockResolvedValue([
      {
        id: "core-one",
        name: "Core One",
        integration_id: "prusa-1",
      },
    ]);
    api.fetchIntegrations.mockResolvedValue([
      {
        id: "prusa-1",
        name: "Core One",
        type: "prusalink",
        config: { enabled: true },
      },
    ]);
    api.reconcilePrinterCheckoff.mockResolvedValue({
      status: {
        state: "printing",
        filename: "bracket.bgcode",
        progress: 42,
      },
      updates: [],
      created_links: [
        {
          id: "link-1",
          profile_id: 7,
          integration_id: "prusa-1",
          printer_id: "core-one",
          host_name: "Core One",
          filename: "bracket.bgcode",
          units: [{ part_id: 9, unit_index: 0 }],
          state: "watching",
          saw_active: true,
          created_at: new Date().toISOString(),
        },
      ],
    });
    const onCheckoffUpdate = vi.fn();

    render(
      <MemoryRouter>
        <PrinterLiveStrip
          engineReady
          onCheckoffUpdate={onCheckoffUpdate}
        />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(api.reconcilePrinterCheckoff).toHaveBeenCalledWith({
        integration_id: "prusa-1",
      });
      expect(onCheckoffUpdate).toHaveBeenCalledWith(7);
    });
  });
});
