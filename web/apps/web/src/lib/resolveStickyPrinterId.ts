/** Keep an explicit Printer pick. Never fall back to the first machine. */

export function resolveStickyPrinterId(
  printers: Array<{ id: string }>,
  sticky: string,
  prev: string,
): string {
  if (prev && printers.some((printer) => printer.id === prev)) return prev;
  if (sticky && printers.some((printer) => printer.id === sticky)) return sticky;
  return "";
}
