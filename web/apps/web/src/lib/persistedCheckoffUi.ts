export const CHECKOFF_UI_STORAGE_KEY = "print-partner.checkoff.ui.v1";

export type CheckoffFilterMode = "all" | "missing" | "done";

export type PersistedCheckoffUi = {
  filter: CheckoffFilterMode;
  compactMode: boolean;
};

const DEFAULT: PersistedCheckoffUi = {
  filter: "all",
  compactMode: false,
};

function isFilter(value: unknown): value is CheckoffFilterMode {
  return value === "all" || value === "missing" || value === "done";
}

export function parsePersistedCheckoffUi(raw: string | null): PersistedCheckoffUi {
  if (!raw) return { ...DEFAULT };
  try {
    const parsed = JSON.parse(raw) as Partial<PersistedCheckoffUi>;
    return {
      filter: isFilter(parsed.filter) ? parsed.filter : DEFAULT.filter,
      compactMode:
        typeof parsed.compactMode === "boolean"
          ? parsed.compactMode
          : DEFAULT.compactMode,
    };
  } catch {
    return { ...DEFAULT };
  }
}

export function serializePersistedCheckoffUi(state: PersistedCheckoffUi): string {
  return JSON.stringify(state);
}

export function loadPersistedCheckoffUi(): PersistedCheckoffUi {
  if (typeof localStorage === "undefined") return { ...DEFAULT };
  return parsePersistedCheckoffUi(localStorage.getItem(CHECKOFF_UI_STORAGE_KEY));
}

export function savePersistedCheckoffUi(state: PersistedCheckoffUi): void {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(CHECKOFF_UI_STORAGE_KEY, serializePersistedCheckoffUi(state));
}
