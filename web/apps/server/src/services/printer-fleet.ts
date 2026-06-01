import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import type { AppRepository } from "../db/repository.js";
import type { PrinterMachine } from "@print-partner/domain";

const FLEET_KEY = "printer.fleet";

const PRESETS_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  "../data/printer_presets.json",
);

export type PrinterPreset = {
  id: string;
  name: string;
  model_slug?: string;
  thumbnail?: string;
  bed_width_mm: number;
  bed_depth_mm: number;
  bed_height_mm: number | null;
  max_filament_slots: number;
};

function ensureSlots(machine: PrinterMachine): PrinterMachine {
  const n = Math.max(1, Math.min(4, machine.max_filament_slots));
  const bySlot = Object.fromEntries(machine.loaded_filaments.map((lf) => [lf.slot, lf]));
  const loaded = [];
  for (let i = 1; i <= n; i++) {
    loaded.push(bySlot[i] ?? { slot: i, filament_color_id: null, label: "" });
  }
  return { ...machine, max_filament_slots: n, loaded_filaments: loaded };
}

export function parsePrinterMachine(data: Record<string, unknown>): PrinterMachine {
  const loaded = Array.isArray(data.loaded_filaments)
    ? data.loaded_filaments.map((x) => {
        const row = x as Record<string, unknown>;
        return {
          slot: Number(row.slot ?? 1),
          filament_color_id: (row.filament_color_id as string | null) ?? null,
          label: String(row.label ?? ""),
        };
      })
    : [];
  const machine: PrinterMachine = {
    id: String(data.id),
    name: String(data.name ?? "Printer"),
    bed_width_mm: Number(data.bed_width_mm ?? 250),
    bed_depth_mm: Number(data.bed_depth_mm ?? 210),
    bed_height_mm: data.bed_height_mm != null ? Number(data.bed_height_mm) : null,
    margin_mm: Number(data.margin_mm ?? 4),
    max_filament_slots: Number(data.max_filament_slots ?? 1),
    loaded_filaments: loaded,
  };
  return ensureSlots(machine);
}

export function loadPrinterPresets(): PrinterPreset[] {
  const raw = JSON.parse(readFileSync(PRESETS_PATH, "utf8")) as Array<Record<string, unknown>>;
  return raw.map((item) => ({
    id: String(item.id ?? ""),
    name: String(item.name ?? "Printer"),
    bed_width_mm: Number(item.bed_width_mm ?? 250),
    bed_depth_mm: Number(item.bed_depth_mm ?? 210),
    bed_height_mm: item.bed_height_mm != null ? Number(item.bed_height_mm) : null,
    max_filament_slots: Number(item.max_filament_slots ?? 1),
    ...(item.model_slug ? { model_slug: String(item.model_slug) } : {}),
    ...(item.thumbnail ? { thumbnail: String(item.thumbnail) } : {}),
  }));
}

export function loadFleet(repo: AppRepository): PrinterMachine[] {
  const raw = repo.getSetting(FLEET_KEY);
  if (!raw) return [];
  try {
    const items = JSON.parse(raw) as Array<Record<string, unknown>>;
    return items.map((x) => parsePrinterMachine(x));
  } catch {
    return [];
  }
}

export function saveFleet(repo: AppRepository, fleet: PrinterMachine[]): void {
  const normalized = fleet.map(ensureSlots);
  repo.setSetting(FLEET_KEY, JSON.stringify(normalized, null, 2));
}

export function newMachineFromPreset(preset: PrinterPreset, name?: string): PrinterMachine {
  const slots = Math.max(1, preset.max_filament_slots);
  return ensureSlots({
    id: `printer-${randomBytes(5).toString("hex")}`,
    name: name ?? preset.name,
    bed_width_mm: preset.bed_width_mm,
    bed_depth_mm: preset.bed_depth_mm,
    bed_height_mm: preset.bed_height_mm,
    margin_mm: 4,
    max_filament_slots: slots,
    loaded_filaments: Array.from({ length: slots }, (_, i) => ({
      slot: i + 1,
      filament_color_id: null,
      label: "",
    })),
  });
}
