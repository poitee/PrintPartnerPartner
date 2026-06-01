import type { MergePart } from "./merge.js";
import type { PartCopy } from "./checkoff-missing.js";

export type { PartCopy };

export type PrinterMachine = {
  id: string;
  name: string;
  bed_width_mm: number;
  bed_depth_mm: number;
  bed_height_mm: number | null;
  margin_mm: number;
  max_filament_slots: number;
  loaded_filaments: Array<{
    slot: number;
    filament_color_id: string | null;
    label: string;
  }>;
};

export type MergePartExport = MergePart & {
  quantityEffective?: number;
  filamentDisplay?: string;
  filamentColorId?: string | null;
  filamentHex?: string | null;
  filament_color_id?: string | null;
  filament_display?: string;
  filament_hex?: string | null;
  quantity_effective?: number;
};

function partFilamentKey(part: MergePartExport): string | null {
  const colorId = part.filamentColorId ?? part.filament_color_id;
  if (colorId) return colorId;
  const display = (part.filamentDisplay ?? part.filament_display ?? "").trim();
  if (display) return `display:${display}`;
  return null;
}

function loadedFilamentIds(printer: PrinterMachine): Set<string> {
  const ids = new Set<string>();
  for (const lf of printer.loaded_filaments) {
    if (lf.filament_color_id) ids.add(lf.filament_color_id);
  }
  return ids;
}

export function assignPartsToPrinters(
  copies: PartCopy[],
  printers: PrinterMachine[],
): [Record<string, PartCopy[]>, string[]] {
  const warnings: string[] = [];
  const byPrinter: Record<string, PartCopy[]> = {};
  for (const p of printers) byPrinter[p.id] = [];
  if (!printers.length) return [byPrinter, ["No printers enabled for this kit."]];

  const filamentToPrinters: Record<string, string[]> = {};
  for (const printer of printers) {
    for (const fid of loadedFilamentIds(printer)) {
      (filamentToPrinters[fid] ??= []).push(printer.id);
    }
  }

  const pickPrinter = (candidates: string[]) =>
    candidates.reduce((a, b) =>
      (byPrinter[a]?.length ?? 0) <= (byPrinter[b]?.length ?? 0) ? a : b,
    );

  const defaultPrinter = printers[0].id;

  for (const copy of copies) {
    const part = copy.part as MergePartExport;
    const key = partFilamentKey(part);
    if (key && filamentToPrinters[key]) {
      const pid = pickPrinter(filamentToPrinters[key]);
      byPrinter[pid].push(copy);
      continue;
    }
    if (key) {
      const label = part.filamentDisplay ?? part.filament_display ?? part.filamentColorId ?? key;
      warnings.push(
        `No printer has ${label} loaded — assigned to ${printers[0].name} (${part.filename})`,
      );
    } else if (part.role) {
      warnings.push(
        `No filament on ${part.filename} (role ${part.role}) — assigned to ${printers[0].name}`,
      );
    }
    byPrinter[defaultPrinter].push(copy);
  }

  return [byPrinter, warnings];
}
