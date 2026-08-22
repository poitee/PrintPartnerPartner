// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import type { PlanDraftWorkspace } from "../api/engine";
import PlanPage from "./PlanPage";

const readyWorkspace: PlanDraftWorkspace = {
  profile_id: 7,
  draft: {
    draft_id: 9,
    state: "open",
    lifecycle_version: 0,
    snapshot_digest: "a".repeat(64),
    base: { revision_id: 3, plan_version: 1 },
  },
  parts: [],
  diff: { base_is_current: true, added: [], removed: [], changed: [] },
  reconciliation: { kind: "ready", reused_units: 0, new_units: 0, surplus_units: 0 },
};

const workspace = vi.hoisted(() => ({
  draftWorkspace: null as PlanDraftWorkspace | null,
  applyActivePlanDraft: vi.fn(),
  rebaseActivePlanDraft: vi.fn(),
  reconcileActivePlanDraft: vi.fn(),
}));

vi.mock("../hooks/useEngineHealth", () => ({
  useEngineHealth: () => ({ health: { ok: true }, error: null, loading: false }),
}));
vi.mock("../context/ProfileContext", () => ({
  useProfileSelection: () => ({
    selectedProfileId: 7,
    profiles: [
      {
        id: 7,
        name: "Voron",
        archived_at: null,
        part_count: 1,
        accepted_progress: { kind: "ready" as const, remaining_units: 1, total_units: 1 },
        build_stale: false,
        freshness: { status: "current" as const },
      },
    ],
  }),
}));
vi.mock("../context/PlanWorkspaceContext", () => ({
  usePlanWorkspace: () => ({
    review: {
      profile_id: 7,
      plan_name: "Voron",
      layers: [],
      totals: {
        included_parts: 1,
        total_print_units: 1,
        by_role: {},
        by_filament: {},
      },
      issues: [],
      has_blockers: false,
      part_groups: [],
    },
    loading: false,
    error: null,
    refresh: vi.fn(),
    draftWorkspace: workspace.draftWorkspace,
    draftError: null,
    applyActivePlanDraft: workspace.applyActivePlanDraft,
    rebaseActivePlanDraft: workspace.rebaseActivePlanDraft,
    reconcileActivePlanDraft: workspace.reconcileActivePlanDraft,
  }),
}));
vi.mock("../context/StlAutoSyncContext", () => ({
  useStlAutoSync: () => ({ banner: { kind: "hidden" as const }, runSync: vi.fn(), busy: false }),
}));
vi.mock("../hooks/useJobRunner", () => ({
  useJobRunner: () => ({ busy: false, runJob: vi.fn() }),
}));
vi.mock("../api/engine", () => ({
  fetchStlNaming: vi.fn().mockResolvedValue({ folder_rules: [] }),
}));
vi.mock("../components/review/ReviewPartsSheet", () => ({
  default: () => <div>Review sheet</div>,
}));

describe("PlanPage Apply ownership", () => {
  afterEach(cleanup);

  beforeEach(() => {
    workspace.draftWorkspace = null;
    workspace.applyActivePlanDraft.mockReset().mockResolvedValue({ plan_version: 2 });
    workspace.rebaseActivePlanDraft.mockReset();
    workspace.reconcileActivePlanDraft.mockReset();
  });

  it("does not show Apply when no saved draft is open", () => {
    render(
      <MemoryRouter>
        <PlanPage />
      </MemoryRouter>,
    );

    expect(screen.getByRole("heading", { name: "Plan" }).textContent).toBe("Plan");
    expect(screen.queryByRole("button", { name: "Apply plan changes" })).toBeNull();
  });

  it("owns Apply for an open saved draft", () => {
    workspace.draftWorkspace = readyWorkspace;
    render(
      <MemoryRouter>
        <PlanPage />
      </MemoryRouter>,
    );

    expect(screen.getByRole("heading", { name: "Saved Plan draft" }).textContent).toBe(
      "Saved Plan draft",
    );
    const apply = screen.getByRole("button", { name: "Apply plan changes" });
    expect(apply.hasAttribute("disabled")).toBe(false);
    fireEvent.click(apply);
    expect(workspace.applyActivePlanDraft).toHaveBeenCalledOnce();
  });
});
