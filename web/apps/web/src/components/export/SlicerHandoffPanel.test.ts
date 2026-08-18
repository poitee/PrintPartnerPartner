import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./SlicerHandoffPanel.tsx", import.meta.url), "utf8");

describe("SlicerHandoffPanel printer selection", () => {
  it("uses the saved plan through the shared enabled-printer resolver", () => {
    expect(source).toMatch(/\bfetchPrintPlan\b/);
    expect(source).toMatch(/\bresolveEnabledPrinterIds\b/);
    expect(source).toMatch(/plan\.enabled_printer_ids/);
  });

  it("does not send the whole fleet directly", () => {
    expect(source).not.toMatch(
      /enabled_printer_ids:\s*printers\.map\(\(p\)\s*=>\s*p\.id\)/,
    );
  });
});
