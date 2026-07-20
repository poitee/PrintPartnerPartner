import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  isWorkflowOnboardingComplete,
  markWorkflowOnboardingComplete,
  WORKFLOW_ONBOARDING_STORAGE_KEY,
} from "./persistedWorkflowOnboarding";

describe("persistedWorkflowOnboarding", () => {
  const store = new Map<string, string>();

  beforeEach(() => {
    store.clear();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, value);
      },
      removeItem: (key: string) => {
        store.delete(key);
      },
      clear: () => store.clear(),
    });
  });

  it("starts incomplete and persists completion", () => {
    expect(isWorkflowOnboardingComplete()).toBe(false);
    markWorkflowOnboardingComplete();
    expect(isWorkflowOnboardingComplete()).toBe(true);
    expect(store.get(WORKFLOW_ONBOARDING_STORAGE_KEY)).toBe("1");
  });
});
