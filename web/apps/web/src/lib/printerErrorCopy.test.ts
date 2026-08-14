import { describe, expect, it } from "vitest";
import {
  isPrinterAuthUnavailable,
  quietPrinterLoadError,
  quietPrinterStatusMessage,
} from "./printerErrorCopy";

describe("printerErrorCopy", () => {
  it("quiets 401 Engine paths", () => {
    const msg = "Engine /api/v1/printers failed: 401";
    expect(isPrinterAuthUnavailable(msg)).toBe(true);
    expect(quietPrinterLoadError(msg)).toEqual({
      quiet: true,
      text: "Printers unavailable",
    });
  });

  it("strips /api paths from status messages", () => {
    expect(
      quietPrinterStatusMessage("Engine /api/v1/integrations/x/status failed: 401"),
    ).toBe("Printers unavailable");
  });
});
