/** Client-side checkoff summary (matches backend progress_summary on included parts). */

export type CheckoffSummaryPart = {
  quantity_effective: number;
  printed_count: number;
  missing: boolean;
};

export function isPartFullyPrinted(part: CheckoffSummaryPart): boolean {
  const qty = Math.max(1, part.quantity_effective);
  return part.printed_count >= qty;
}

/** Mirror backend stack toggle: first N units printed (checkoff UX). */
export function applyStackToggle(
  units: boolean[],
  unitIndex: number,
  completed: boolean,
): boolean[] {
  const qty = Math.max(1, units.length);
  const count = completed ? unitIndex + 1 : unitIndex;
  const clamped = Math.max(0, Math.min(count, qty));
  return Array.from({ length: qty }, (_, i) => i < clamped);
}

export function printedCountFromUnits(units: boolean[]): number {
  return units.filter(Boolean).length;
}

export function formatCheckoffSummary(parts: CheckoffSummaryPart[]): string {
  if (parts.length === 0) {
    return "0/0 parts fully printed · 0/0 units";
  }
  const partsDone = parts.filter((p) => isPartFullyPrinted(p)).length;
  const totalUnits = parts.reduce(
    (sum, p) => sum + Math.max(1, p.quantity_effective),
    0,
  );
  const printedUnits = parts.reduce((sum, p) => sum + p.printed_count, 0);
  return (
    `${partsDone}/${parts.length} parts fully printed · ` +
    `${printedUnits}/${totalUnits} units`
  );
}
