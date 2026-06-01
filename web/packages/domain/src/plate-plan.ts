import type { PartCopy } from "./checkoff-missing.js";
import { assignPartsToPrinters, type PrinterMachine } from "./filament-assigner.js";
import {
  packCopiesGroupedByLocation,
  packCopiesOnPrinter,
  type PlateLayout,
} from "./plate-packer.js";

export type CopyRef = { match_key: string; unit: number };

export function copyRefKey(ref: CopyRef): string {
  return `${ref.match_key}:${ref.unit}`;
}

export function copyRefFromCopy(copy: PartCopy): CopyRef {
  return { match_key: copy.part.matchKey, unit: copy.unit };
}

export type PrinterPlatePlan = {
  printer_id: string;
  plates: CopyRef[][];
  unassigned: CopyRef[];
};

export type KitPlateLayout = {
  spacing_mm: number;
  printers: PrinterPlatePlan[];
  pool: CopyRef[];
};

export function kitPlateLayoutFromDict(data: Record<string, unknown>): KitPlateLayout {
  const printersRaw = data.printers;
  const printers: PrinterPlatePlan[] = Array.isArray(printersRaw)
    ? printersRaw
        .filter((p): p is Record<string, unknown> => typeof p === "object" && p != null)
        .map((p) => ({
          printer_id: String(p.printer_id ?? ""),
          plates: Array.isArray(p.plates)
            ? p.plates.map((plate) =>
                Array.isArray(plate)
                  ? plate
                      .filter((r): r is Record<string, unknown> => typeof r === "object" && r != null)
                      .map((r) => ({
                        match_key: String(r.match_key),
                        unit: Number(r.unit ?? 1),
                      }))
                  : [],
              )
            : [],
          unassigned: Array.isArray(p.unassigned)
            ? p.unassigned
                .filter((r): r is Record<string, unknown> => typeof r === "object" && r != null)
                .map((r) => ({
                  match_key: String(r.match_key),
                  unit: Number(r.unit ?? 1),
                }))
            : [],
        }))
    : [];
  const poolRaw = data.pool;
  const pool: CopyRef[] = Array.isArray(poolRaw)
    ? poolRaw
        .filter((r): r is Record<string, unknown> => typeof r === "object" && r != null)
        .map((r) => ({ match_key: String(r.match_key), unit: Number(r.unit ?? 1) }))
    : [];
  return {
    spacing_mm: Number(data.spacing_mm ?? 4),
    printers,
    pool,
  };
}

export function kitPlateLayoutToDict(layout: KitPlateLayout): Record<string, unknown> {
  return {
    spacing_mm: layout.spacing_mm,
    printers: layout.printers.map((p) => ({
      printer_id: p.printer_id,
      plates: p.plates.map((plate) =>
        plate.map((r) => ({ match_key: r.match_key, unit: r.unit })),
      ),
      unassigned: p.unassigned.map((r) => ({ match_key: r.match_key, unit: r.unit })),
    })),
    pool: layout.pool.map((r) => ({ match_key: r.match_key, unit: r.unit })),
  };
}

function copyLookup(copies: PartCopy[]): Map<string, PartCopy> {
  const map = new Map<string, PartCopy>();
  for (const c of copies) map.set(copyRefKey(copyRefFromCopy(c)), c);
  return map;
}

function resolveRefs(refs: CopyRef[], lookup: Map<string, PartCopy>): PartCopy[] {
  const out: PartCopy[] = [];
  for (const ref of refs) {
    const copy = lookup.get(copyRefKey(ref));
    if (copy) out.push(copy);
  }
  return out;
}

export function autoPlateLayout(
  printers: PrinterMachine[],
  copies: PartCopy[],
  spacingMm = 4,
): [KitPlateLayout, string[]] {
  const warnings: string[] = [];
  const [byPrinter, assignWarnings] = assignPartsToPrinters(copies, printers);
  warnings.push(...assignWarnings);

  const layout: KitPlateLayout = { spacing_mm: spacingMm, printers: [], pool: [] };
  for (const printer of printers) {
    const pcopies = byPrinter[printer.id] ?? [];
    if (!pcopies.length) continue;
    const [plates, packWarnings] = packCopiesGroupedByLocation(printer, pcopies, {
      spacing_mm: spacingMm,
    });
    warnings.push(...packWarnings);
    layout.printers.push({
      printer_id: printer.id,
      plates: plates.map((plate) => plate.items.map((item) => copyRefFromCopy(item.copy))),
      unassigned: [],
    });
  }
  return [layout, warnings];
}

export function resolveLayoutToPlates(
  layout: KitPlateLayout,
  printers: PrinterMachine[],
  copies: PartCopy[],
): [Array<[PrinterMachine, PlateLayout]>, string[]] {
  const warnings: string[] = [];
  const [, assignWarnings] = assignPartsToPrinters(copies, printers);
  warnings.push(...assignWarnings);
  const lookup = copyLookup(copies);
  const allPlates: Array<[PrinterMachine, PlateLayout]> = [];

  if (layout.pool.length) {
    warnings.push(
      `${layout.pool.length} part(s) still unclassified — assign to a printer before export.`,
    );
  }

  const planById = Object.fromEntries(layout.printers.map((p) => [p.printer_id, p]));

  for (const printer of printers) {
    const plan = planById[printer.id];
    if (!plan || (!plan.plates.length && !plan.unassigned.length)) {
      const [byPrinter] = assignPartsToPrinters(copies, printers);
      const pcopies = byPrinter[printer.id] ?? [];
      if (!pcopies.length) continue;
      const [plates, packWarnings] = packCopiesGroupedByLocation(printer, pcopies, {
        spacing_mm: layout.spacing_mm,
      });
      warnings.push(...packWarnings);
      for (const plate of plates) allPlates.push([printer, plate]);
      continue;
    }

    let plateCounter = 1;
    for (const plateRefs of plan.plates) {
      if (!plateRefs.length) continue;
      const pcopies = resolveRefs(plateRefs, lookup);
      if (!pcopies.length) continue;
      const [packedPlates, packWarnings] = packCopiesOnPrinter(printer, pcopies, {
        spacing_mm: layout.spacing_mm,
      });
      warnings.push(...packWarnings);
      if (packedPlates.length > 1) {
        warnings.push(
          `${printer.name} plate ${plateCounter}: assigned group needs ` +
            `${packedPlates.length} beds — split across export files.`,
        );
      }
      for (const packed of packedPlates) {
        packed.index = plateCounter;
        allPlates.push([printer, packed]);
        plateCounter += 1;
      }
    }
    if (plan.unassigned.length) {
      const ua = resolveRefs(plan.unassigned, lookup);
      if (ua.length) {
        warnings.push(`${ua.length} part(s) unassigned on ${printer.name} — skipped for export.`);
      }
    }
  }

  return [allPlates, warnings];
}
