import type { PartCopy } from "./checkoff-missing.js";
import type { MergePartExport } from "./filament-assigner.js";
import { quantityEffective } from "./merge.js";

export function mergePartsToCopies(parts: MergePartExport[]): PartCopy[] {
  const copies: PartCopy[] = [];
  for (const part of parts) {
    if (!part.included) continue;
    const qty = Math.max(1, part.quantityEffective ?? part.quantity_effective ?? quantityEffective(part));
    for (let unit = 1; unit <= qty; unit++) copies.push({ part, unit });
  }
  return copies;
}
