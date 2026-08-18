import type { PrintGroup, PrinterMachine } from "../api/engine";

export type AssignmentBucket = {
  printerId: string | null;
  printerName: string;
  groups: PrintGroup[];
};

/** Group print rows under the assigned or suggested printer for the preview tree. */
export function groupAssignmentsByPrinter(
  groups: PrintGroup[],
  printers: PrinterMachine[],
  assignments: Record<string, string>,
): AssignmentBucket[] {
  const buckets = new Map<string, AssignmentBucket>();
  for (const printer of printers) {
    buckets.set(printer.id, {
      printerId: printer.id,
      printerName: printer.name,
      groups: [],
    });
  }
  const leftover: AssignmentBucket = {
    printerId: null,
    printerName: "Unassigned",
    groups: [],
  };
  for (const group of groups) {
    const id = assignments[group.group_key] || group.suggested_printer_id || null;
    const bucket = id && buckets.has(id) ? buckets.get(id) : leftover;
    bucket!.groups.push(group);
  }
  const out = [...buckets.values()].filter((b) => b.groups.length > 0);
  if (leftover.groups.length) out.push(leftover);
  return out;
}
