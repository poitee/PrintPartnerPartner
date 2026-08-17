export type ProfileSourceMode = "assigned" | "auto_match";

export function latestSyncedAt(timestamps: Array<string | null | undefined>): string | null {
  let best: string | null = null;
  let bestMs = -Infinity;
  for (const raw of timestamps) {
    if (!raw) continue;
    const ms = Date.parse(raw);
    if (Number.isNaN(ms)) continue;
    if (ms >= bestMs) {
      bestMs = ms;
      best = raw;
    }
  }
  return best;
}

function namesLooselyMatch(a: string, b: string): boolean {
  const x = a.trim().toLowerCase();
  const y = b.trim().toLowerCase();
  if (!x || !y) return false;
  return x === y || x.includes(y) || y.includes(x);
}

export function processCompatibleWithMachine(
  compatiblePrintersJson: string | null | undefined,
  machineProfileName: string,
): boolean {
  if (!compatiblePrintersJson) return true;
  let list: unknown;
  try {
    list = JSON.parse(compatiblePrintersJson);
  } catch {
    return true;
  }
  if (!Array.isArray(list) || list.length === 0) return true;
  const names = list.map((x) => String(x ?? ""));
  return names.some((n) => namesLooselyMatch(n, machineProfileName));
}

export type PrinterProfileAssignmentView = {
  printer_id: string;
  profile_source: ProfileSourceMode;
  machine_profile_id: number | null;
  filament_slots: Array<{ slot_index: number; filament_profile_id: number | null }>;
  last_synced_at: string | null;
  compatible_processes: Array<{ id: number; name: string }>;
};
