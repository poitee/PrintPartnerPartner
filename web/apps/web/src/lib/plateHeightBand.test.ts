import { describe, expect, it } from "vitest";
import {
  HEIGHT_BAND_ORDER,
  isHeightBand,
  itemHeightBandBadge,
  plateHeightBandSummary,
} from "./plateHeightBand";

/** Shorthand for a plate item as it arrives on PlateFootprint. */
const item = (band?: string | null, heightMm?: number) => ({
  height_band: band,
  height_mm: heightMm,
});

describe("isHeightBand", () => {
  it("accepts exactly the five domain bands", () => {
    for (const band of HEIGHT_BAND_ORDER) expect(isHeightBand(band)).toBe(true);
    expect(HEIGHT_BAND_ORDER).toHaveLength(5);
  });

  it("rejects unknown / empty / non-string values", () => {
    for (const bad of ["", "huge", "FLAT", "very tall", null, undefined, 3, {}]) {
      expect(isHeightBand(bad)).toBe(false);
    }
  });
});

describe("plateHeightBandSummary", () => {
  it("labels a uniform plate with that band and its mm range", () => {
    const s = plateHeightBandSummary([item("tall"), item("tall"), item("tall")]);
    expect(s.label).toBe("Tall");
    expect(s.mixed).toBe(false);
    expect(s.bands).toEqual(["tall"]);
    expect(s.title).toContain("150–300 mm");
    // Uniform plates get the band's own colour, not the neutral mixed outline.
    expect(s.variant).toBe("warning");
  });

  it("labels a mixed plate as shortest–tallest regardless of item order", () => {
    const s = plateHeightBandSummary([
      item("tall"),
      item("flat"),
      item("medium"),
    ]);
    expect(s.label).toBe("Flat–Tall");
    expect(s.mixed).toBe(true);
    // Always ordered shortest → tallest, not first-seen order.
    expect(s.bands).toEqual(["flat", "medium", "tall"]);
    expect(s.variant).toBe("outline");
    expect(s.title).toBe("Mixed height bands: Flat, Medium, Tall");
  });

  it("dedupes repeated bands so a two-band plate is not reported as three", () => {
    const s = plateHeightBandSummary([
      item("short"),
      item("short"),
      item("very-tall"),
      item("short"),
    ]);
    expect(s.bands).toEqual(["short", "very-tall"]);
    expect(s.label).toBe("Short–Very tall");
  });

  it("falls back to Unclassified when no item carries a usable band", () => {
    const s = plateHeightBandSummary([item(undefined), item(null), item("bogus")]);
    expect(s.label).toBe("Unclassified");
    expect(s.variant).toBe("outline");
    expect(s.bands).toEqual([]);
    expect(s.unclassifiedCount).toBe(3);
    expect(s.title).toContain("re-run the pack preview");
  });

  it("still names the band when only some items are classified", () => {
    const s = plateHeightBandSummary([item("medium"), item(undefined)]);
    expect(s.label).toBe("Medium");
    expect(s.mixed).toBe(false);
    expect(s.unclassifiedCount).toBe(1);
  });

  it("handles an empty or absent plate without throwing", () => {
    for (const empty of [[], null, undefined]) {
      const s = plateHeightBandSummary(empty);
      expect(s.label).toBe("Unclassified");
      expect(s.unclassifiedCount).toBe(0);
      expect(s.title).toBe("This plate has no parts.");
    }
  });

  it("reflects a strategy switch: same parts, band plates vs one mixed plate", () => {
    // Height Band strategy → one plate per band, each uniform.
    const flatPlate = plateHeightBandSummary([item("flat"), item("flat")]);
    const tallPlate = plateHeightBandSummary([item("tall")]);
    expect([flatPlate.label, tallPlate.label]).toEqual(["Flat", "Tall"]);
    expect(flatPlate.mixed || tallPlate.mixed).toBe(false);

    // Location strategy → the same parts land together and read as mixed.
    const locationPlate = plateHeightBandSummary([
      item("flat"),
      item("flat"),
      item("tall"),
    ]);
    expect(locationPlate.label).toBe("Flat–Tall");
    expect(locationPlate.mixed).toBe(true);
  });
});

describe("itemHeightBandBadge", () => {
  it("shows the band name plus the part's measured height", () => {
    const badge = itemHeightBandBadge(item("short", 42.649));
    expect(badge.label).toBe("Short");
    expect(badge.variant).toBe("info");
    expect(badge.title).toBe("Short (10–50 mm) — 42.6 mm tall");
  });

  it("omits the measurement when height_mm is missing or not finite", () => {
    expect(itemHeightBandBadge(item("flat")).title).toBe("Flat (under 10 mm)");
    expect(itemHeightBandBadge(item("flat", Number.NaN)).title).toBe("Flat (under 10 mm)");
    expect(itemHeightBandBadge(item("flat", Number.POSITIVE_INFINITY)).title).toBe(
      "Flat (under 10 mm)",
    );
  });

  it("falls back to Unclassified for a missing or unknown band", () => {
    for (const bad of [undefined, null, "gigantic"]) {
      const badge = itemHeightBandBadge(item(bad, 12));
      expect(badge.label).toBe("Unclassified");
      expect(badge.variant).toBe("outline");
    }
  });

  it("gives every band a distinct label and variant", () => {
    const labels = HEIGHT_BAND_ORDER.map((b) => itemHeightBandBadge(item(b)).label);
    const variants = HEIGHT_BAND_ORDER.map((b) => itemHeightBandBadge(item(b)).variant);
    expect(new Set(labels).size).toBe(HEIGHT_BAND_ORDER.length);
    expect(new Set(variants).size).toBe(HEIGHT_BAND_ORDER.length);
    // "Unclassified" must not collide with a real band label.
    expect(labels).not.toContain("Unclassified");
  });
});
