// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import PlansPage from "./PlansPage";

const state = vi.hoisted(() => ({
  profiles: [
    {
      id: 7,
      name: "Voron",
      archived_at: null as string | null,
      part_count: 24,
      accepted_progress: { kind: "ready" as const, remaining_units: 6, total_units: 30 },
      build_stale: true,
      last_used_at: null,
    },
  ],
  loading: false,
  error: null as string | null,
  mobile: true,
}));

const api = vi.hoisted(() => ({
  fetchPrinterCheckoffLinks: vi.fn(),
}));

vi.mock("../hooks/useEngineHealth", () => ({
  useEngineHealth: () => ({ health: { ok: true }, error: null, loading: false }),
}));
vi.mock("../api/engine", () => ({
  fetchPrinterCheckoffLinks: (...args: unknown[]) => api.fetchPrinterCheckoffLinks(...args),
}));
vi.mock("../context/ProfileContext", () => ({
  useProfileSelection: () => ({
    profiles: state.profiles,
    selectedProfileId: 7,
    setSelectedProfileId: vi.fn(),
    loading: state.loading,
    error: state.error,
    reloadProfiles: vi.fn(),
  }),
}));
vi.mock("../context/PlanActionsContext", () => ({
  usePlanActions: () => ({
    openCreatePlan: vi.fn(),
    openRenamePlan: vi.fn(),
    openDuplicatePlan: vi.fn(),
    openDeletePlan: vi.fn(),
    openArchivePlan: vi.fn(),
    openRestorePlan: vi.fn(),
  }),
}));
vi.mock("../queries/profiles", () => ({
  useTouchProfileLastUsedMutation: () => ({ mutate: vi.fn() }),
}));
vi.mock("../hooks/useMediaQuery", () => ({
  useMediaQuery: () => state.mobile,
}));
vi.mock("../components/share/IncomingSharesCard", () => ({
  default: () => <div data-testid="incoming-shares">Shared builds</div>,
}));

describe("PlansPage", () => {
  afterEach(cleanup);

  beforeEach(() => {
    state.profiles = [
      {
        id: 7,
        name: "Voron",
        archived_at: null,
        part_count: 24,
        accepted_progress: { kind: "ready" as const, remaining_units: 6, total_units: 30 },
        build_stale: true,
        last_used_at: null,
      },
    ];
    state.loading = false;
    state.error = null;
    state.mobile = true;
    api.fetchPrinterCheckoffLinks.mockReset();
    api.fetchPrinterCheckoffLinks.mockResolvedValue({ links: [] });
  });

  it("renders one accessible Builds tree with complete controls on small screens", () => {
    render(
      <MemoryRouter>
        <PlansPage />
      </MemoryRouter>,
    );

    const mobileBuilds = screen.getByRole("list", { name: "Builds" });
    expect(
      within(mobileBuilds).getByRole("button", { name: "Open Voron" }).tagName,
    ).toBe("BUTTON");
    expect(
      within(mobileBuilds).getByRole("button", { name: "Actions for Voron" }).tagName,
    ).toBe("BUTTON");
    expect(within(mobileBuilds).getByText("6 remaining").textContent).toBe("6 remaining");
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.getByTestId("incoming-shares").textContent).toBe("Shared builds");
  });

  it("renders one accessible Builds table on wider screens", () => {
    state.mobile = false;

    render(
      <MemoryRouter>
        <PlansPage />
      </MemoryRouter>,
    );

    expect(screen.getByRole("table", { name: "Builds" }).tagName).toBe("TABLE");
    expect(screen.queryByRole("list", { name: "Builds" })).toBeNull();
  });

  it("announces build loading through a polite live status", () => {
    state.profiles = [];
    state.loading = true;

    const { rerender } = render(
      <MemoryRouter>
        <PlansPage />
      </MemoryRouter>,
    );

    const status = screen.getByRole("status");
    expect(status.getAttribute("aria-live")).toBe("polite");
    expect(status.getAttribute("aria-atomic")).toBe("true");
    expect(status.textContent).toContain("Loading builds");

    state.loading = false;
    rerender(
      <MemoryRouter>
        <PlansPage />
      </MemoryRouter>,
    );

    expect(screen.getByRole("status")).toBe(status);
    expect(status.textContent).toBe("");
  });

  it("links Checkoff and Production from a Build row", () => {
    state.mobile = false;

    render(
      <MemoryRouter>
        <PlansPage />
      </MemoryRouter>,
    );

    expect(screen.getByRole("link", { name: "Checkoff for Voron" }).getAttribute("href")).toBe(
      "/progress?profile=7",
    );
    expect(screen.getByRole("link", { name: "Production for Voron" }).getAttribute("href")).toBe(
      "/export?profile=7",
    );
  });

  it("filters the Builds list by name", () => {
    state.mobile = false;
    state.profiles = [
      {
        id: 7,
        name: "Voron",
        archived_at: null,
        part_count: 24,
        accepted_progress: { kind: "ready" as const, remaining_units: 6, total_units: 30 },
        build_stale: true,
        last_used_at: null,
      },
      {
        id: 8,
        name: "A1 Mini",
        archived_at: null,
        part_count: 2,
        accepted_progress: { kind: "ready" as const, remaining_units: 0, total_units: 2 },
        build_stale: false,
        last_used_at: null,
      },
    ];

    render(
      <MemoryRouter>
        <PlansPage />
      </MemoryRouter>,
    );

    fireEvent.change(screen.getByRole("searchbox", { name: "Search builds" }), {
      target: { value: "a1" },
    });

    expect(screen.getByRole("button", { name: "Open A1 Mini" }).textContent).toBe("A1 Mini");
    expect(screen.queryByRole("button", { name: "Open Voron" })).toBeNull();
  });

  it("opens an existing Build in Plan", () => {
    render(
      <MemoryRouter initialEntries={["/builds"]}>
        <Routes>
          <Route path="/builds" element={<PlansPage />} />
          <Route path="/plan" element={<div>Plan destination</div>} />
        </Routes>
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Open Voron" }));
    expect(screen.getByText("Plan destination").textContent).toBe("Plan destination");
  });

  it("announces initial plan load failures as alerts", () => {
    state.profiles = [];
    state.error = "database unavailable";

    render(
      <MemoryRouter>
        <PlansPage />
      </MemoryRouter>,
    );

    expect(screen.getByRole("alert").textContent).toContain(
      "Could not load builds: database unavailable",
    );
  });

  it("offers Restore on an archived Build instead of Archive", async () => {
    const user = userEvent.setup();
    state.mobile = false;
    state.profiles = [
      {
        id: 7,
        name: "Voron",
        archived_at: "2026-08-21T12:00:00.000Z",
        part_count: 24,
        accepted_progress: { kind: "ready" as const, remaining_units: 0, total_units: 30 },
        build_stale: false,
        last_used_at: null,
      },
    ];

    render(
      <MemoryRouter>
        <PlansPage />
      </MemoryRouter>,
    );

    await user.click(screen.getByRole("button", { name: "Archived" }));
    await user.click(screen.getByRole("button", { name: "Actions for Voron" }));

    expect((await screen.findByRole("menuitem", { name: "Restore" })).textContent).toContain(
      "Restore",
    );
    expect(screen.queryByRole("menuitem", { name: "Archive" })).toBeNull();
  });

  it("shows printing and awaiting-verify counts on a Build row", async () => {
    state.mobile = false;
    api.fetchPrinterCheckoffLinks.mockImplementation(async (options?: { state?: string }) => {
      if (options?.state === "watching") {
        return {
          links: [
            { id: "p1", state: "watching", profile_id: 7 },
            { id: "p2", state: "watching", profile_id: 7 },
          ],
        };
      }
      if (options?.state === "awaiting_verify") {
        return { links: [{ id: "v1", state: "awaiting_verify", profile_id: 7 }] };
      }
      return { links: [] };
    });

    render(
      <MemoryRouter>
        <PlansPage />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText("2 printing").textContent).toBe("2 printing");
    });
    expect(screen.getByText("1 to verify").textContent).toBe("1 to verify");
  });
});
