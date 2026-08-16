/**
 * Height-band presentation for plate group cards.
 *
 * The bands themselves are produced server-side by classifyHeightBand() in
 * packages/domain/src/plate-packer.ts and reach the web app as the
 * `height_band` field on each PlateFootprint (see placedItemDict in
 * apps/server/src/services/plate-workspace.ts). This module only maps those
 * values to labels/badge styling and summarises a plate's worth of items —
 * it deliberately re-declares the band list instead of importing
 * @print-partner/domain, which is a server-only workspace dep (apps/web
 * depends on @print-partner/contracts only).
 *
 * Thresholds mirrored from HEIGHT_BAND_THRESHOLDS_MM: flat <10, short 10–50,
 * medium 50–150, tall 150–300, very-tall >=300 (upper bound exclusive).
 */

/**
 * Height band a part falls into. Mirrors the domain `HeightBand` union; the
 * wire type (PlateFootprint.height_band in api/engine.ts) is a plain string
 * because the server may send a band this build doesn't know about, so every
 * value is narrowed through isHeightBand() before it is used as a key.
 */
export type HeightBand = "flat" | "short" | "medium" | "tall" | "very-tall";

/** Shortest to tallest — the order bands are listed in on a mixed plate. */
export const HEIGHT_BAND_ORDER: HeightBand[] = [
  "flat",
  "short",
  "medium",
  "tall",
  "very-tall",
];

/** Short badge text. Keep terse — this renders inside a pill on a card header. */
export const HEIGHT_BAND_LABEL: Record<HeightBand, string> = {
  flat: "Flat",
  short: "Short",
  medium: "Medium",
  tall: "Tall",
  "very-tall": "Very tall",
};

/** Millimetre range per band, shown as the badge tooltip. */
export const HEIGHT_BAND_RANGE: Record<HeightBand, string> = {
  flat: "under 10 mm",
  short: "10–50 mm",
  medium: "50–150 mm",
  tall: "150–300 mm",
  "very-tall": "300 mm and up",
};

/**
 * Badge variant per band. Distinct hue per band (muted → info → success →
 * warning → primary) so bands are separable at a glance; the band name is
 * always rendered as text too, so colour is never the only signal.
 */
export const HEIGHT_BAND_VARIANT: Record<HeightBand, HeightBandBadgeVariant> = {
  flat: "muted",
  short: "info",
  medium: "success",
  tall: "warning",
  "very-tall": "default",
};

export type HeightBandBadgeVariant =
  | "default"
  | "muted"
  | "outline"
  | "success"
  | "warning"
  | "info";

const BAND_SET = new Set<string>(HEIGHT_BAND_ORDER);

export function isHeightBand(value: unknown): value is HeightBand {
  return typeof value === "string" && BAND_SET.has(value);
}

export type PlateHeightBandItem = {
  height_band?: string | null;
  height_mm?: number | null;
};

export type PlateHeightBandSummary = {
  /** Distinct bands present on the plate, shortest first. Empty when nothing is classified. */
  bands: HeightBand[];
  /** Badge text: a single band name, a "Flat–Tall" span, or "Unclassified". */
  label: string;
  /** Badge variant — the band's own colour, or a neutral outline for a mixed plate. */
  variant: HeightBandBadgeVariant;
  /** Tooltip: mm range for a single band, band list for mixed, reason for unclassified. */
  title: string;
  /** True when the plate holds parts from more than one band. */
  mixed: boolean;
  /** Items whose height_band was missing or unrecognised. */
  unclassifiedCount: number;
};

/**
 * Summarise the height bands on one plate.
 *
 * A Height Band plate is uniform by construction, so this collapses to that
 * band's name. Location-grouped (or otherwise mixed) plates report the span
 * from shortest to tallest band, which is the case the >2× height-variance
 * pack warning also fires on.
 *
 * Items with no usable `height_band` are counted but never invent a band —
 * a plate with nothing classified reads "Unclassified" rather than guessing.
 */
export function plateHeightBandSummary(
  items: readonly PlateHeightBandItem[] | null | undefined,
): PlateHeightBandSummary {
  const present = new Set<HeightBand>();
  let unclassifiedCount = 0;

  for (const item of items ?? []) {
    if (isHeightBand(item?.height_band)) present.add(item.height_band);
    else unclassifiedCount += 1;
  }

  const bands = HEIGHT_BAND_ORDER.filter((b) => present.has(b));

  if (bands.length === 0) {
    return {
      bands,
      label: "Unclassified",
      variant: "outline",
      title:
        unclassifiedCount > 0
          ? "No height band on these parts — re-run the pack preview to classify them."
          : "This plate has no parts.",
      mixed: false,
      unclassifiedCount,
    };
  }

  if (bands.length === 1) {
    const band = bands[0];
    return {
      bands,
      label: HEIGHT_BAND_LABEL[band],
      variant: HEIGHT_BAND_VARIANT[band],
      title: `Height band: ${HEIGHT_BAND_LABEL[band]} (${HEIGHT_BAND_RANGE[band]})`,
      mixed: false,
      unclassifiedCount,
    };
  }

  const shortest = bands[0];
  const tallest = bands[bands.length - 1];
  return {
    bands,
    label: `${HEIGHT_BAND_LABEL[shortest]}–${HEIGHT_BAND_LABEL[tallest]}`,
    variant: "outline",
    title: `Mixed height bands: ${bands.map((b) => HEIGHT_BAND_LABEL[b]).join(", ")}`,
    mixed: true,
    unclassifiedCount,
  };
}

/** Per-item badge text/tooltip/variant, with an explicit unclassified fallback. */
export function itemHeightBandBadge(item: PlateHeightBandItem): {
  label: string;
  variant: HeightBandBadgeVariant;
  title: string;
} {
  if (!isHeightBand(item?.height_band)) {
    return {
      label: "Unclassified",
      variant: "outline",
      title: "No height band on this part.",
    };
  }
  const band = item.height_band;
  const mm =
    typeof item.height_mm === "number" && Number.isFinite(item.height_mm)
      ? ` — ${item.height_mm.toFixed(1)} mm tall`
      : "";
  return {
    label: HEIGHT_BAND_LABEL[band],
    variant: HEIGHT_BAND_VARIANT[band],
    title: `${HEIGHT_BAND_LABEL[band]} (${HEIGHT_BAND_RANGE[band]})${mm}`,
  };
}
