import { resolveEnabledPrinterIds } from "./enabledPrinters";

type HandoffDependencies = {
  fetchPrinterIds: () => Promise<readonly string[]>;
  fetchEnabledPrinterIds: (profileId: number) => Promise<readonly string[] | null | undefined>;
};

export type HandoffPrinterSelection =
  | { kind: "no-printers" }
  | { kind: "ready"; printerIds: string[] };

export async function loadHandoffPrinterSelection(
  profileId: number,
  dependencies: HandoffDependencies,
): Promise<HandoffPrinterSelection> {
  const fleetIds = [...(await dependencies.fetchPrinterIds())];
  if (fleetIds.length === 0) return { kind: "no-printers" };

  const enabledIds = await dependencies.fetchEnabledPrinterIds(profileId);
  return {
    kind: "ready",
    printerIds: resolveEnabledPrinterIds(fleetIds, enabledIds),
  };
}
