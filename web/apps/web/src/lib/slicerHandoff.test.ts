import { describe, expect, it } from "vitest";
import { loadHandoffPrinterSelection } from "./slicerHandoff";

describe("loadHandoffPrinterSelection", () => {
  it("stops before requesting the plan when no printers are configured", async () => {
    const calls: string[] = [];

    const result = await loadHandoffPrinterSelection(7, {
      fetchPrinterIds: async () => {
        calls.push("printers");
        return [];
      },
      fetchEnabledPrinterIds: async () => {
        calls.push("plan");
        return ["printer-a"];
      },
    });

    expect(result).toEqual({ kind: "no-printers" });
    expect(calls).toEqual(["printers"]);
  });

  it("loads the plan after the fleet and resolves its enabled subset", async () => {
    const calls: string[] = [];

    const result = await loadHandoffPrinterSelection(7, {
      fetchPrinterIds: async () => {
        calls.push("printers");
        return ["printer-a", "printer-b"];
      },
      fetchEnabledPrinterIds: async (profileId) => {
        calls.push(`plan:${profileId}`);
        return ["printer-b"];
      },
    });

    expect(result).toEqual({ kind: "ready", printerIds: ["printer-b"] });
    expect(calls).toEqual(["printers", "plan:7"]);
  });
});
