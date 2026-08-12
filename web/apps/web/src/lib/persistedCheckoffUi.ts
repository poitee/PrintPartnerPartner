export const CHECKOFF_UI_STORAGE_KEY = "print-partner.checkoff.ui.v1";

export type CheckoffFilterMode = "all" | "missing" | "done";

export type PersistedCheckoffUi = {
  filter: CheckoffFilterMode;
  compactMode: boolean;
  /** When true, print uses continuous layout (fewer forced page breaks). */
  continuousPrintLayout: boolean;
  /**
   * Per-plan Progress row order (part ids). Local-only — parts API has no
   * display-order field. Keyed by plan/profile id string.
   */
  partOrderByPlanId: Record<string, number[]>;
};

const DEFAULT: PersistedCheckoffUi = {
  /** Progress stage defaults to Missing (Workflow mock). */
  filter: "missing",
  compactMode: false,
  continuousPrintLayout: false,
  partOrderByPlanId: {},
};

function isFilter(value: unknown): value is CheckoffFilterMode {
  return value === "all" || value === "missing" || value === "done";
}

function parsePartOrderByPlanId(value: unknown): Record<string, number[]> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out: Record<string, number[]> = {};
  for (const [planId, order] of Object.entries(value as Record<string, unknown>)) {
    if (!planId || !Array.isArray(order)) continue;
    const ids = order.filter((id): id is number => typeof id === "number" && Number.isFinite(id));
    if (ids.length) out[planId] = ids;
  }
  return out;
}

export function parsePersistedCheckoffUi(raw: string | null): PersistedCheckoffUi {
  if (!raw) return { ...DEFAULT, partOrderByPlanId: {} };
  try {
    const parsed = JSON.parse(raw) as Partial<PersistedCheckoffUi>;
    return {
      filter: isFilter(parsed.filter) ? parsed.filter : DEFAULT.filter,
      compactMode:
        typeof parsed.compactMode === "boolean"
          ? parsed.compactMode
          : DEFAULT.compactMode,
      continuousPrintLayout:
        typeof parsed.continuousPrintLayout === "boolean"
          ? parsed.continuousPrintLayout
          : DEFAULT.continuousPrintLayout,
      partOrderByPlanId: parsePartOrderByPlanId(parsed.partOrderByPlanId),
    };
  } catch {
    return { ...DEFAULT, partOrderByPlanId: {} };
  }
}

export function serializePersistedCheckoffUi(state: PersistedCheckoffUi): string {
  return JSON.stringify(state);
}

export function loadPersistedCheckoffUi(): PersistedCheckoffUi {
  if (typeof localStorage === "undefined") {
    return { ...DEFAULT, partOrderByPlanId: {} };
  }
  return parsePersistedCheckoffUi(localStorage.getItem(CHECKOFF_UI_STORAGE_KEY));
}

export function savePersistedCheckoffUi(state: PersistedCheckoffUi): void {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(CHECKOFF_UI_STORAGE_KEY, serializePersistedCheckoffUi(state));
}

export function getPartOrderForPlan(
  state: PersistedCheckoffUi,
  planId: number | null | undefined,
): number[] {
  if (planId == null) return [];
  return state.partOrderByPlanId[String(planId)] ?? [];
}

export function withPartOrderForPlan(
  state: PersistedCheckoffUi,
  planId: number,
  order: number[],
): PersistedCheckoffUi {
  return {
    ...state,
    partOrderByPlanId: {
      ...state.partOrderByPlanId,
      [String(planId)]: order,
    },
  };
}
