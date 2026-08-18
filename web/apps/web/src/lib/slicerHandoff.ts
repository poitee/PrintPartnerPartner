type HandoffDependencies = {
  fetchPrinterIds: () => Promise<readonly string[]>;
  fetchEnabledPrinterIds: (profileId: number) => Promise<readonly string[] | null | undefined>;
};

export type HandoffPrinterSelection =
  | { kind: "no-printers" }
  | { kind: "ready"; printerIds: string[] };

export async function loadHandoffPrinterSelection(
  _profileId: number,
  _dependencies: HandoffDependencies,
): Promise<HandoffPrinterSelection> {
  return { kind: "no-printers" };
}
