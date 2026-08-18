/**
 * Client-side mirror of domain resolveEnabledPrinters:
 * empty or unknown-only IDs mean "use the whole fleet".
 */
export function resolveEnabledPrinterIds(
  fleetIds: string[],
  enabledIds: string[] | null | undefined,
): string[] {
  const ids = enabledIds ?? [];
  if (!ids.length) return [...fleetIds];
  const selected = fleetIds.filter((id) => ids.includes(id));
  return selected.length ? selected : [...fleetIds];
}
