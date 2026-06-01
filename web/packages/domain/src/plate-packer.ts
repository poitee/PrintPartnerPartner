import type { PartCopy } from "./checkoff-missing.js";
import { folderKeyFromRelativePath } from "./parts-grouping.js";
import { repoNameFromSourceLayer } from "./parts-tree.js";
import type { MergePartExport, PrinterMachine } from "./filament-assigner.js";
import { loadStlMesh, placeMeshOnBed, type StlMesh } from "./stl-mesh.js";

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
