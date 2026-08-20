// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import type { PlanReview } from "../../api/engine";
import { REVIEW_PARTS_UI_STORAGE_KEY } from "../../lib/persistedReviewPartsUi";
import ReviewPartsSheet from "./ReviewPartsSheet";

const queryMocks = vi.hoisted(() => ({
  usePlanReviewQuery: vi.fn(() => ({ data: null })),
}));

vi.mock("../../context/ProfileContext", () => ({
  useProfileSelection: () => ({ profiles: [] }),
}));
vi.mock("../../context/PlanWorkspaceContext", () => ({
  usePlanWorkspace: () => ({
    setQuantity: vi.fn(),
    setIncluded: vi.fn(),
    setSpoolmanSpool: vi.fn(),
    toggleUnit: vi.fn(),
    busyPartId: null,
  }),
}));
vi.mock("../../queries/planReview", () => ({
  usePlanReviewQuery: queryMocks.usePlanReviewQuery,
}));
vi.mock("../../queries/roleFilaments", () => ({
  useRoleFilamentsQuery: () => ({ data: [] }),
}));
vi.mock("../../hooks/useSpoolmanEnabled", () => ({
  useSpoolmanEnabled: () => ({ configured: false, integrationId: null }),
}));
vi.mock("../../hooks/useMediaQuery", () => ({
  useMediaQuery: () => false,
}));

const review: PlanReview = {
  profile_id: 7,
  plan_name: "Voron",
  layers: [],
  totals: {
    included_parts: 0,
    total_print_units: 0,
    by_role: {},
    by_filament: {},
  },
  issues: [],
  has_blockers: false,
  part_groups: [],
};

describe("ReviewPartsSheet accessibility", () => {
  beforeEach(() => {
    localStorage.clear();
    queryMocks.usePlanReviewQuery.mockClear();
  });

  it("gives the parts search control a persistent accessible name", () => {
    render(
      <MemoryRouter>
        <ReviewPartsSheet review={review} planName="Voron" />
      </MemoryRouter>,
    );

    expect(
      screen.getByRole("searchbox", { name: "Search review parts" }).tagName,
    ).toBe("INPUT");
  });

  it("requests excluded parts without changing the workspace projection", () => {
    localStorage.setItem(
      REVIEW_PARTS_UI_STORAGE_KEY,
      JSON.stringify({ includedFilter: "excluded" }),
    );

    render(
      <MemoryRouter>
        <ReviewPartsSheet review={review} planName="Voron" />
      </MemoryRouter>,
    );

    expect(queryMocks.usePlanReviewQuery).toHaveBeenCalledWith(7, {
      includeExcluded: true,
      enabled: true,
    });
  });
});
