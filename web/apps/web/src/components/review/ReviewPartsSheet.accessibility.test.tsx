// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import type { PlanReview } from "../../api/engine";
import ReviewPartsSheet from "./ReviewPartsSheet";

vi.mock("../../context/ProfileContext", () => ({
  useProfileSelection: () => ({ profiles: [] }),
}));
vi.mock("../../context/PlanWorkspaceContext", () => ({
  usePlanWorkspace: () => ({
    setQuantity: vi.fn(),
    setIncluded: vi.fn(),
    setSpoolmanSpool: vi.fn(),
    toggleUnit: vi.fn(),
    reload: vi.fn(),
    busyPartId: null,
    loadedRevision: 0,
  }),
}));
vi.mock("../../context/CopilotUiContext", () => ({
  useCopilotUiOptional: () => undefined,
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
});
