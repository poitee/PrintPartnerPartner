// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import GlobalProductionPage from "./GlobalProductionPage";

const state = vi.hoisted(() => ({
  profiles: [
    {
      id: 7,
      name: "Voron",
      archived_at: null,
      part_count: 24,
      accepted_progress: { kind: "ready" as const, remaining_units: 6, total_units: 30 },
      build_stale: true,
      last_used_at: "2026-08-20T00:00:00Z",
    },
    {
      id: 8,
      name: "Done Build",
      archived_at: null,
      part_count: 2,
      accepted_progress: { kind: "ready" as const, remaining_units: 0, total_units: 2 },
      build_stale: false,
      last_used_at: null,
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

describe("GlobalProductionPage", () => {
  afterEach(cleanup);

  beforeEach(() => {
    state.loading = false;
    state.error = null;
    state.profiles = [
      {
        id: 7,
        name: "Voron",
        archived_at: null,
        part_count: 24,
        accepted_progress: { kind: "ready" as const, remaining_units: 6, total_units: 30 },
        build_stale: true,
        last_used_at: "2026-08-20T00:00:00Z",
      },
      {
        id: 8,
        name: "Done Build",
        archived_at: null,
        part_count: 2,
        accepted_progress: { kind: "ready" as const, remaining_units: 0, total_units: 2 },
        build_stale: false,
        last_used_at: null,
      },
    ];
  });

  it("aggregates remaining Checkoff work across Builds", () => {
    render(
      <MemoryRouter>
        <GlobalProductionPage />
      </MemoryRouter>,
    );

    expect(screen.getByRole("heading", { name: "Production" }).textContent).toBe("Production");
    expect(screen.getByText(/6 remaining/).textContent).toContain("6 remaining");
    expect(screen.getByRole("link", { name: "Open Voron in Production" }).getAttribute("href")).toBe(
      "/production?profile=7",
    );
    expect(screen.getByRole("link", { name: "Checkoff for Voron" }).getAttribute("href")).toBe(
      "/progress?profile=7",
    );
  });
});
