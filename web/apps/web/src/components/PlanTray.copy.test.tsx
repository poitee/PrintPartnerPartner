// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import PlanTray from "./PlanTray";

vi.mock("./parts/PartThumb", () => ({ default: () => null }));
vi.mock("../hooks/useFlushBuildPageSaves", () => ({
  useFlushBuildPageSaves: () => vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../context/StlAutoSyncContext", () => ({
  useStlAutoSync: () => ({ busy: false }),
}));
vi.mock("../context/ProfileContext", () => ({
  useProfileSelection: () => ({
    selectedProfileId: 7,
    profiles: [{ id: 7, name: "Voron", part_count: 0, build_stale: false }],
  }),
}));
vi.mock("../context/PlanWorkspaceContext", () => ({
  usePlanWorkspace: () => ({ review: null, loading: false }),
}));

afterEach(() => {
  cleanup();
  document.documentElement.style.removeProperty("--plan-tray-height");
});

describe("PlanTray spine copy", () => {
  it("points empty assembly and Production at spine destinations, not Library or Export", () => {
    render(
      <MemoryRouter initialEntries={["/plan?profile=7"]}>
        <PlanTray />
      </MemoryRouter>,
    );

    expect(screen.getByText(/Pick STLs in/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Sources" }).getAttribute("href")).toBe(
      "/sources?profile=7",
    );
    expect(screen.queryByText(/Library/)).toBeNull();
    expect(screen.getByRole("button", { name: "Production" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Export/ })).toBeNull();
    expect(screen.getByRole("link", { name: "Open Plan" }).getAttribute("href")).toBe(
      "/plan?profile=7",
    );
  });
});
