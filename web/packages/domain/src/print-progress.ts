/** Print progress helpers (ported from Python print_progress.py — pure logic). */

export type ProgressRow = {
  id?: number;
  partId: number;
  unitIndex: number;
  completed: boolean;
};

export function dedupeProgressRows(rows: ProgressRow[]): ProgressRow[] {
  const byIndex = new Map<number, ProgressRow[]>();
  for (const row of rows) {
    const group = byIndex.get(row.unitIndex) ?? [];
    group.push(row);
    byIndex.set(row.unitIndex, group);
  }
  const out: ProgressRow[] = [];
  for (const group of byIndex.values()) {
    if (group.length <= 1) {
      out.push(...group);
      continue;
    }
    const completed = group.some((r) => r.completed);
    const keep = group.reduce((a, b) => ((a.id ?? 0) > (b.id ?? 0) ? a : b));
    out.push({ ...keep, completed });
  }
  return out;
}

export function getPrintUnits(rows: ProgressRow[], qty: number): boolean[] {
  const flags: Record<number, boolean> = {};
  for (const r of rows) {
    flags[r.unitIndex] = flags[r.unitIndex] || r.completed;
  }
  const n = Math.max(1, qty);
  return Array.from({ length: n }, (_, i) => flags[i] ?? false);
}

export function ensureProgressRows(rows: ProgressRow[], partId: number, qty: number): ProgressRow[] {
  const deduped = dedupeProgressRows(rows.filter((r) => r.partId === partId));
  const n = Math.max(1, qty);
  const byIndex = new Map(deduped.map((r) => [r.unitIndex, r]));
  const out: ProgressRow[] = [];
  for (let unitIndex = 0; unitIndex < n; unitIndex++) {
    const existing = byIndex.get(unitIndex);
    out.push(
      existing ?? { partId, unitIndex, completed: false },
    );
  }
  return out;
}

export function setPrintedUnitCount(rows: ProgressRow[], partId: number, qty: number, completedCount: number): ProgressRow[] {
  const n = Math.max(1, qty);
  const count = Math.max(0, Math.min(completedCount, n));
  const ensured = ensureProgressRows(rows, partId, n);
  const others = rows.filter((r) => r.partId !== partId);
  const updated = ensured.map((r) => ({
    ...r,
    completed: r.unitIndex < count,
  }));
  return [...others, ...updated];
}

export function toggleCheckoffUnit(
  rows: ProgressRow[],
  partId: number,
  qty: number,
  unitIndex: number,
  completed: boolean,
): ProgressRow[] {
  const n = Math.max(1, qty);
  if (unitIndex >= n) return rows;
  const target = completed ? unitIndex + 1 : unitIndex;
  return setPrintedUnitCount(rows, partId, n, target);
}

export function getPrintedCounts(
  parts: Array<{ id: number; quantityEffective: number }>,
  allRows: ProgressRow[],
): Map<number, [number, number]> {
  const counts = new Map<number, [number, number]>();
  for (const part of parts) {
    const partRows = allRows.filter((r) => r.partId === part.id);
    const total = Math.max(1, part.quantityEffective);
    const completed = partRows.filter((r) => r.completed).length;
    counts.set(part.id, [completed, total]);
  }
  return counts;
}
