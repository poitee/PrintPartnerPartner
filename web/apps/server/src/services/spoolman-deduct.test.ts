import { describe, expect, it } from "vitest";
import {
  recordSpoolmanDeduction,
  spoolmanDeductionAlreadyRecorded,
  spoolmanDeductionSettingKey,
} from "./spoolman-deduct.js";

describe("spoolman deduction identity", () => {
  it("keys one result per Printer job and skips a second apply", () => {
    const store = new Map<string, string>();
    const repo = {
      getSetting: (key: string) => store.get(key) ?? null,
      setSetting: (key: string, value: string) => {
        store.set(key, value);
      },
    };

    expect(spoolmanDeductionSettingKey("job-1")).toBe("spoolman.deduction.job-1");
    expect(spoolmanDeductionAlreadyRecorded(repo, "job-1")).toBe(false);

    recordSpoolmanDeduction(repo, "job-1", { deducted_mm: 120, at: "2026-08-22T02:00:00Z" });

    expect(spoolmanDeductionAlreadyRecorded(repo, "job-1")).toBe(true);
    expect(spoolmanDeductionAlreadyRecorded(repo, "job-2")).toBe(false);
    expect(JSON.parse(store.get("spoolman.deduction.job-1") ?? "{}")).toMatchObject({
      deducted_mm: 120,
    });
  });
});
