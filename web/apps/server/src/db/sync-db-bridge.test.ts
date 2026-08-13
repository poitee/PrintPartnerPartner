import { describe, expect, it } from "vitest";
import { runSerializedSettingsMutation } from "./sync-db-bridge.js";

describe("runSerializedSettingsMutation", () => {
  it("runs the callback and returns its value without Promise/syncAwait", () => {
    expect(runSerializedSettingsMutation(() => 42)).toBe(42);
  });

  it("allows nested calls on the same stack", () => {
    const result = runSerializedSettingsMutation(() =>
      runSerializedSettingsMutation(() => "nested"),
    );
    expect(result).toBe("nested");
  });

  it("releases the lock so a later call can run", () => {
    runSerializedSettingsMutation(() => "first");
    expect(runSerializedSettingsMutation(() => "second")).toBe("second");
  });
});
