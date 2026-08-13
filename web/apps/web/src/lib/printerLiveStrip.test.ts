import { describe, expect, it } from "vitest";
import {
  formatEtaSeconds,
  formatPrinterLiveLine,
  printerLiveStripTone,
} from "./printerLiveStrip";

describe("formatEtaSeconds", () => {
  it("returns null for missing or invalid", () => {
    expect(formatEtaSeconds(undefined)).toBeNull();
    expect(formatEtaSeconds(null)).toBeNull();
    expect(formatEtaSeconds(-1)).toBeNull();
    expect(formatEtaSeconds(Number.NaN)).toBeNull();
  });

  it("formats seconds, minutes, and hours", () => {
    expect(formatEtaSeconds(45)).toBe("~45s");
    expect(formatEtaSeconds(120)).toBe("~2m");
    expect(formatEtaSeconds(3700)).toBe("~1h 1m");
    expect(formatEtaSeconds(7200)).toBe("~2h");
  });
});

describe("formatPrinterLiveLine", () => {
  it("shows loading placeholder", () => {
    expect(formatPrinterLiveLine({ name: "Trident", status: null })).toBe("Trident · …");
  });

  it("formats idle and offline", () => {
    expect(
      formatPrinterLiveLine({ name: "Trident", status: { state: "idle", message: "Idle" } }),
    ).toBe("Trident · Idle");
    expect(
      formatPrinterLiveLine({ name: "Trident", status: { state: "offline", message: "down" } }),
    ).toBe("Trident · Offline");
  });

  it("formats printing with filename, progress, and ETA", () => {
    expect(
      formatPrinterLiveLine({
        name: "Shop Voron",
        status: {
          state: "printing",
          filename: "frame_x.gcode",
          progress: 34.2,
          eta_seconds: 720,
        },
      }),
    ).toBe("Shop Voron · Printing · frame_x.gcode · 34% · ETA ~12m");
  });

  it("formats complete", () => {
    expect(
      formatPrinterLiveLine({
        name: "Trident",
        status: { state: "complete", filename: "frame_x.gcode" },
      }),
    ).toBe("Trident · Complete · frame_x.gcode");
  });

  it("omits ETA when missing", () => {
    expect(
      formatPrinterLiveLine({
        name: "Shop Voron",
        status: { state: "printing", filename: "a.gcode", progress: 10 },
      }),
    ).toBe("Shop Voron · Printing · a.gcode · 10%");
  });
});

describe("printerLiveStripTone", () => {
  it("maps known states", () => {
    expect(printerLiveStripTone("printing")).toBe("printing");
    expect(printerLiveStripTone("complete")).toBe("complete");
    expect(printerLiveStripTone("unknown")).toBe("unknown");
    expect(printerLiveStripTone(undefined)).toBe("unknown");
  });
});
