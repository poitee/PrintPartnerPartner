// @vitest-environment jsdom

import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
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

describe("PlansPage", () => {
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
  });

  it("provides complete plan controls in the small-screen card list", () => {
    render(
      <MemoryRouter>
        <PlansPage />
      </MemoryRouter>,
    );

    const mobilePlans = screen.getByRole("list", { name: "Plans on small screens" });
    expect(within(mobilePlans).getByRole("button", { name: "Select Voron" })).toBeTruthy();
    expect(within(mobilePlans).getByRole("button", { name: "Actions for Voron" })).toBeTruthy();
    expect(within(mobilePlans).getByText("6 remaining")).toBeTruthy();
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
