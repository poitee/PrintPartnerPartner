import { describe, expect, it } from "vitest";
import { resolveEnabledPrinterIds } from "./enabledPrinters";

describe("resolveEnabledPrinterIds", () => {
  const fleet = ["voron", "mk4"];

  it("uses the whole fleet when enabled ids are empty or missing", () => {
    expect(resolveEnabledPrinterIds(fleet, [])).toEqual(fleet);
    expect(resolveEnabledPrinterIds(fleet, null)).toEqual(fleet);
    expect(resolveEnabledPrinterIds(fleet, undefined)).toEqual(fleet);
  });

  it("returns the matching subset", () => {
    expect(resolveEnabledPrinterIds(fleet, ["mk4"])).toEqual(["mk4"]);
  });

  it("falls back to the fleet when no ids match", () => {
    expect(resolveEnabledPrinterIds(fleet, ["deleted-printer"])).toEqual(fleet);
  });
});
