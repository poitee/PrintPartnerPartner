import type { PartCopy } from "./checkoff-missing.js";
import { folderKeyFromRelativePath } from "./parts-grouping.js";
import { repoNameFromSourceLayer } from "./parts-tree.js";
import type { MergePartExport, PrinterMachine } from "./filament-assigner.js";
import { loadStlMesh, placeMeshOnBed, type StlMesh } from "./stl-mesh.js";

export type HeightBand = "flat" | "short" | "medium" | "tall" | "very-tall";

/**
 * Height band thresholds (mm), chosen to reflect common 3D-printing part
 * height use cases:
 *   flat:      < 10 mm   — baseplates, badges, thin panels
 *   short:     10–50 mm  — brackets, small enclosures, spacers
 *   medium:    50–150 mm — most functional parts, boxes, housings
 *   tall:      150–300 mm — vases, tall enclosures, most single-plate maximum
 *   very-tall: > 300 mm  — full-height prints near/above typical printer Z limits
 * Upper bound of each band is exclusive; the next band's lower bound is inclusive,
 * i.e. a part exactly at a threshold value falls into the taller band.
 */
export const HEIGHT_BAND_THRESHOLDS_MM = {
  flat: 10,
  short: 50,
  medium: 150,
  tall: 300,
} as const;

/**
 * Classify a part height (mm) into one of five height bands.
 * Pure function: given the same input it always returns the same output.
 *
 * Negative heights are invalid mesh data; they are classified as "flat" (the
 * lowest band) rather than throwing, so callers can surface a separate
 * validation warning without this classification itself failing. NaN is
 * likewise treated as "flat" (safest default for unknown/bad data).
 */
export function classifyHeightBand(heightMm: number): HeightBand {
  if (Number.isNaN(heightMm) || heightMm < HEIGHT_BAND_THRESHOLDS_MM.flat) return "flat";
  if (heightMm < HEIGHT_BAND_THRESHOLDS_MM.short) return "short";
  if (heightMm < HEIGHT_BAND_THRESHOLDS_MM.medium) return "medium";
  if (heightMm < HEIGHT_BAND_THRESHOLDS_MM.tall) return "tall";
  return "very-tall";
}

/** Human-readable labels for each height band, used as plate `group_label` when packing by Height Band. */
export const HEIGHT_BAND_LABELS: Record<HeightBand, string> = {
  flat: "Flat (<10mm)",
  short: "Short (10–50mm)",
  medium: "Medium (50–150mm)",
  tall: "Tall (150–300mm)",
  "very-tall": "Very Tall (>300mm)",
};

/** Iteration order from shortest to tallest band, used when grouping/sorting by Height Band. */
export const HEIGHT_BAND_ORDER: HeightBand[] = ["flat", "short", "medium", "tall", "very-tall"];

/**
 * Strategy used to group parts into plates.
 *   location:    group by filament + source repo/folder (existing default behavior)
 *   height_band: group by classifyHeightBand(bounds.heightMm) — see packCopiesGroupedByHeightBand
 */
export type GroupingStrategy = "location" | "height_band";

function partFilamentLabel(part: MergePartExport): string {
  const label = (part.filamentDisplay ?? part.filament_display ?? "").trim();
  if (label) return label;
  const colorId = part.filamentColorId ?? part.filament_color_id;
  if (colorId) return colorId;
  if (part.role) return `(filament not set — ${part.role})`;
  return "(filament not set)";
}

export type PlacedItem = {
  copy: PartCopy;
  mesh: StlMesh;
  x_mm: number;
  y_mm: number;
  width_mm: number;
  depth_mm: number;
  height_mm: number;
  heightBand: HeightBand;
};

export type PlateLayout = {
  printer_id: string;
  index: number;
  items: PlacedItem[];
  group_label: string;
};

function loadMeshForCopy(copy: PartCopy): [StlMesh | null, string | null] {
  const part = copy.part as MergePartExport;
  const stlPath = part.absolutePath;
  if (!stlPath) return [null, `Missing STL: ${part.relativePath}`];
  try {
    const mesh = loadStlMesh(stlPath);
    if (!mesh) return [null, `Could not load ${part.relativePath}`];
    return [mesh, null];
  } catch (e) {
    return [null, `Could not load ${part.relativePath}: ${e instanceof Error ? e.message : String(e)}`];
  }
}

/**
 * Check a completed plate's height variance and warn when the spread between
 * the tallest and shortest part exceeds 2x the shortest part's height. Applies
 * uniformly to every plate produced by packCopiesOnPrinter, regardless of which
 * grouping strategy (location, height band, or none) selected the parts on it —
 * mixed-height plates cause uneven cooling / support needs during printing.
 *
 * Returned so callers can surface it to the user (e.g. as a toast) alongside
 * other pack warnings — see
 * export3mfJobResult.ts / exportStlJobResult.ts for the existing
 * warnings-array-to-toast pattern this plugs into.
 */
function checkPlateHeightVariance(
  printer: PrinterMachine,
  plateIndex: number,
  items: PlacedItem[],
): string | null {
  const heights = items.map((i) => i.height_mm).filter((h) => Number.isFinite(h) && h > 0);
  if (heights.length < 2) return null;
  const minH = Math.min(...heights);
  const maxH = Math.max(...heights);
  const variance = maxH - minH;
  if (minH <= 0 || variance <= 2 * minH) return null;
  const warning =
    `Plate ${plateIndex} on ${printer.name}: height variance ${variance.toFixed(1)} mm exceeds ` +
    `2× the shortest part (${minH.toFixed(1)} mm) — consider grouping by Height Band.`;
  return warning;
}

export function packCopiesOnPrinter(
  printer: PrinterMachine,
  copies: PartCopy[],
  options?: { spacing_mm?: number | null },
): [PlateLayout[], string[]] {
  const warnings: string[] = [];
  if (!copies.length) return [[], warnings];

  const margin = printer.margin_mm;
  const spacing = options?.spacing_mm ?? margin;
  const bedW = printer.bed_width_mm - 2 * margin;
  const bedD = printer.bed_depth_mm - 2 * margin;
  const maxZ = printer.bed_height_mm;

  const loaded: Array<[PartCopy, StlMesh, number, number, number]> = [];
  for (const copy of copies) {
    const [mesh, err] = loadMeshForCopy(copy);
    if (err) {
      warnings.push(err);
      continue;
    }
    if (!mesh) continue;
    const w = mesh.bounds.widthMm;
    const d = mesh.bounds.depthMm;
    const h = mesh.bounds.heightMm;
    if (w > bedW || d > bedD) {
      warnings.push(
        `${(copy.part as MergePartExport).filename} (${w.toFixed(0)}×${d.toFixed(0)} mm) too large for ` +
          `${printer.name} bed (${printer.bed_width_mm.toFixed(0)}×${printer.bed_depth_mm.toFixed(0)} mm)`,
      );
      continue;
    }
    if (maxZ != null && h > maxZ) {
      warnings.push(
        `${(copy.part as MergePartExport).filename} height ${h.toFixed(0)} mm exceeds ` +
          `${printer.name} Z limit ${maxZ.toFixed(0)} mm`,
      );
    }
    loaded.push([copy, mesh, w, d, h]);
  }

  loaded.sort((a, b) => Math.max(b[2], b[3]) - Math.max(a[2], a[3]));

  const totalFootprint = loaded.reduce((sum, [, , w, d]) => sum + w * d, 0);
  const bedArea = Math.max(bedW, 0) * Math.max(bedD, 0);
  if (bedArea > 0 && totalFootprint > bedArea * 0.9 && loaded.length > 1) {
    const estPlates = Math.max(2, Math.floor(totalFootprint / bedArea) + 1);
    warnings.push(
      `Estimated ${estPlates} plate(s) needed on ${printer.name} ` +
        `(${totalFootprint.toFixed(0)} mm² footprint on ${bedArea.toFixed(0)} mm² bed).`,
    );
  }

  const plates: PlateLayout[] = [];
  let currentItems: PlacedItem[] = [];
  let layoutX = 0;
  let layoutY = 0;
  let rowHeight = 0;
  let plateIndex = 1;

  const flushPlate = () => {
    if (currentItems.length) {
      const varianceWarning = checkPlateHeightVariance(printer, plateIndex, currentItems);
      if (varianceWarning) warnings.push(varianceWarning);
      plates.push({
        printer_id: printer.id,
        index: plateIndex,
        items: currentItems,
        group_label: "",
      });
      plateIndex += 1;
    }
    currentItems = [];
    layoutX = 0;
    layoutY = 0;
    rowHeight = 0;
  };

  for (const [copy, mesh, width, depth, height] of loaded) {
    if (layoutX > 0 && layoutX + width > bedW) {
      layoutX = 0;
      layoutY += rowHeight + spacing;
      rowHeight = 0;
    }
    if (layoutY + depth > bedD) flushPlate();

    const placedMesh = placeMeshOnBed(mesh, margin + layoutX, margin + layoutY);
    currentItems.push({
      copy,
      mesh: placedMesh,
      x_mm: margin + layoutX,
      y_mm: margin + layoutY,
      width_mm: width,
      depth_mm: depth,
      height_mm: height,
      heightBand: classifyHeightBand(height),
    });
    layoutX += width + spacing;
    rowHeight = Math.max(rowHeight, depth);
  }
  flushPlate();
  return [plates, warnings];
}

export function packCopiesGroupedByLocation(
  printer: PrinterMachine,
  copies: PartCopy[],
  options?: { spacing_mm?: number | null },
): [PlateLayout[], string[]] {
  if (!copies.length) return [[], []];
  const groups: Record<string, PartCopy[]> = {};
  for (const copy of copies) {
    const part = copy.part as MergePartExport;
    const key = [
      partFilamentLabel(part),
      repoNameFromSourceLayer(part.sourceLayer),
      folderKeyFromRelativePath(part.relativePath),
    ].join("\0");
    (groups[key] ??= []).push(copy);
  }

  const allPlates: PlateLayout[] = [];
  const allWarnings: string[] = [];
  let plateIndex = 1;
  const sortedKeys = Object.keys(groups).sort((a, b) => a.localeCompare(b));
  for (const key of sortedKeys) {
    const [filament, repo, folder] = key.split("\0");
    const folderDisp = folder === "(root)" ? "root" : folder;
    const label = `${filament} · ${repo} · ${folderDisp}`;
    const [plates, warnings] = packCopiesOnPrinter(printer, groups[key], options);
    for (const plate of plates) {
      plate.index = plateIndex;
      plate.group_label = label;
      plateIndex += 1;
      allPlates.push(plate);
    }
    allWarnings.push(...warnings);
  }
  return [allPlates, allWarnings];
}

/**
 * Group parts into their height bands (flat/short/medium/tall/very-tall) and
 * pack each band onto its own plate(s), ordered shortest band to tallest.
 * Used when the active grouping strategy is "Height Band" — see GroupingStrategy.
 *
 * Height is classified from the same mesh bounds.heightMm used by
 * packCopiesOnPrinter, via classifyHeightBand. A part whose STL fails to load
 * is skipped here (as in packCopiesOnPrinter) and its load error is still
 * surfaced through the returned warnings.
 */
export function packCopiesGroupedByHeightBand(
  printer: PrinterMachine,
  copies: PartCopy[],
  options?: { spacing_mm?: number | null },
): [PlateLayout[], string[]] {
  if (!copies.length) return [[], []];

  const bandGroups: Record<HeightBand, PartCopy[]> = {
    flat: [],
    short: [],
    medium: [],
    tall: [],
    "very-tall": [],
  };
  const allWarnings: string[] = [];

  for (const copy of copies) {
    const [mesh, err] = loadMeshForCopy(copy);
    if (err) {
      allWarnings.push(err);
      continue;
    }
    if (!mesh) continue;
    const band = classifyHeightBand(mesh.bounds.heightMm);
    bandGroups[band].push(copy);
  }

  const allPlates: PlateLayout[] = [];
  let plateIndex = 1;
  for (const band of HEIGHT_BAND_ORDER) {
    const bandCopies = bandGroups[band];
    if (!bandCopies.length) continue;
    // Sort tallest-first within the band so the shelf packer places the largest
    // footprints first (matches the sort packCopiesOnPrinter would otherwise do).
    const [plates, warnings] = packCopiesOnPrinter(printer, bandCopies, options);
    for (const plate of plates) {
      plate.index = plateIndex;
      plate.group_label = HEIGHT_BAND_LABELS[band];
      plateIndex += 1;
      allPlates.push(plate);
    }
    allWarnings.push(...warnings);
  }
  return [allPlates, allWarnings];
}

/**
 * Dispatch to the packer for the given grouping strategy. Height Band grouping
 * sorts/groups parts into their bands (flat → very-tall) before shelf-packing;
 * Location grouping (default) buckets by filament + source repo/folder.
 */
export function packCopiesGrouped(
  strategy: GroupingStrategy,
  printer: PrinterMachine,
  copies: PartCopy[],
  options?: { spacing_mm?: number | null },
): [PlateLayout[], string[]] {
  if (strategy === "height_band") {
    return packCopiesGroupedByHeightBand(printer, copies, options);
  }
  return packCopiesGroupedByLocation(printer, copies, options);
}
