// @vitest-environment jsdom

import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import PlansPage from "./PlansPage";

const state = vi.hoisted(() => ({
  profiles: [
    {
      id: 7,
      name: "Voron",
      archived_at: null,
      part_count: 24,
      remaining_units: 6,
      total_units: 30,
      build_stale: true,
    },
  ],
  loading: false,
  error: null as string | null,
  mobile: true,
}));

vi.mock("../hooks/useEngineHealth", () => ({
  useEngineHealth: () => ({ health: { ok: true }, error: null, loading: false }),
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
  }),
}));
vi.mock("../queries/profiles", () => ({
  useTouchProfileLastUsedMutation: () => ({ mutate: vi.fn() }),
}));
vi.mock("../hooks/useMediaQuery", () => ({
  useMediaQuery: () => state.mobile,
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
        remaining_units: 6,
        total_units: 30,
        build_stale: true,
      },
    ];
    state.loading = false;
    state.error = null;
    state.mobile = true;
  });

  it("renders one accessible Plans tree with complete controls on small screens", () => {
    render(
      <MemoryRouter>
        <PlansPage />
      </MemoryRouter>,
    );

    const mobilePlans = screen.getByRole("list", { name: "Plans" });
    expect(
      within(mobilePlans).getByRole("button", { name: "Select Voron" }).tagName,
    ).toBe("BUTTON");
    expect(
      within(mobilePlans).getByRole("button", { name: "Actions for Voron" }).tagName,
    ).toBe("BUTTON");
    expect(within(mobilePlans).getByText("6 remaining").textContent).toBe("6 remaining");
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("renders one accessible Plans table on wider screens", () => {
    state.mobile = false;

    render(
      <MemoryRouter>
        <PlansPage />
      </MemoryRouter>,
    );

    expect(screen.getByRole("table", { name: "Plans" }).tagName).toBe("TABLE");
    expect(screen.queryByRole("list", { name: "Plans" })).toBeNull();
  });

  it("announces plan loading through a polite live status", () => {
    state.profiles = [];
    state.loading = true;

    render(
      <MemoryRouter>
        <PlansPage />
      </MemoryRouter>,
    );

    const status = screen.getByRole("status");
    expect(status.getAttribute("aria-live")).toBe("polite");
    expect(status.getAttribute("aria-atomic")).toBe("true");
    expect(status.textContent).toContain("Loading plans");
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
      "Could not load plans: database unavailable",
    );
  });
});
