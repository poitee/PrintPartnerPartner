import { describe, expect, it } from "vitest";
import { resolveStickyPrinterId } from "./resolveStickyPrinterId";

const printers = [{ id: "a" }, { id: "b" }];

describe("resolveStickyPrinterId", () => {
  it("keeps the current pick when it is still in the list", () => {
    expect(resolveStickyPrinterId(printers, "b", "a")).toBe("a");
  });

  it("restores a sticky pick when the current pick is gone", () => {
    expect(resolveStickyPrinterId(printers, "b", "gone")).toBe("b");
  });

  it("does not select the first printer when nothing was chosen", () => {
    expect(resolveStickyPrinterId(printers, "", "")).toBe("");
    expect(resolveStickyPrinterId(printers, "missing", "")).toBe("");
  });
});
