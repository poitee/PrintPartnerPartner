import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDebouncedAutosave } from "./debouncedAutosave";

describe("createDebouncedAutosave", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("waits for debounce before saving", async () => {
    const onSave = vi.fn(async () => {});
    const autosave = createDebouncedAutosave({
      delayMs: 700,
      onSave,
      isDirty: () => true,
    });

    autosave.schedule();
    expect(onSave).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(700);
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it("flush on dispose saves pending changes before debounce completes", async () => {
    const onSave = vi.fn(async () => {});
    const autosave = createDebouncedAutosave({
      delayMs: 700,
      onSave,
      isDirty: () => true,
    });

    autosave.schedule();
    autosave.dispose();
    await vi.runAllTimersAsync();

    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it("dispose skips save when nothing is dirty", async () => {
    const onSave = vi.fn(async () => {});
    const autosave = createDebouncedAutosave({
      delayMs: 700,
      onSave,
      isDirty: () => false,
    });

    autosave.schedule();
    autosave.dispose();
    await vi.runAllTimersAsync();

    expect(onSave).not.toHaveBeenCalled();
  });

  it("flush cancels a scheduled debounced save and saves immediately", async () => {
    const onSave = vi.fn(async () => {});
    const autosave = createDebouncedAutosave({
      delayMs: 700,
      onSave,
      isDirty: () => true,
    });

    autosave.schedule();
    await autosave.flush();
    await vi.runAllTimersAsync();

    expect(onSave).toHaveBeenCalledTimes(1);
  });
});
