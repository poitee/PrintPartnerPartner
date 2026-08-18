import { describe, expect, it } from "vitest";
import {
  clearAuxiliaryError,
  currentAuxiliaryError,
  setAuxiliaryError,
  type AuxiliaryErrors,
} from "./auxiliaryErrors";

describe("auxiliary error lifecycle", () => {
  it("clears a fetch error after that fetch succeeds", () => {
    const failed = setAuxiliaryError({}, "printer-activity", "Could not refresh printer activity");
    const recovered = clearAuxiliaryError(failed, "printer-activity");

    expect(currentAuxiliaryError(recovered)).toBeNull();
  });

  it("does not clear an unrelated fetch error", () => {
    let errors: AuxiliaryErrors = {};
    errors = setAuxiliaryError(errors, "printer-activity", "Printer activity failed");
    errors = setAuxiliaryError(errors, "phase-progress", "Phase progress failed");
    errors = clearAuxiliaryError(errors, "printer-activity");

    expect(currentAuxiliaryError(errors)).toBe("Phase progress failed");
  });
});
