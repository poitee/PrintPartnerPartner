import { folderKeyFromRelativePath } from "./parts-grouping.js";
import { repoNameFromSourceLayer } from "./parts-tree.js";
import type { PartCopy } from "./checkoff-missing.js";
import {
  assignPartsToPrinters,
  loadedFilamentKeys,
  type MergePartExport,
  type PrinterMachine,
} from "./filament-assigner.js";
import { objectDisplayName } from "./export-3mf.js";

export function partFilamentKey(part: MergePartExport): string {
  const colorId = part.filamentColorId ?? part.filament_color_id;
  if (colorId) return colorId;
  const display = (part.filamentDisplay ?? part.filament_display ?? "").trim();
  if (display) return `display:${display}`;
  return "__unset__";
}

export function partFilamentLabel(part: MergePartExport): string {
  const label = (part.filamentDisplay ?? part.filament_display ?? "").trim();
  if (label) return label;
  const colorId = part.filamentColorId ?? part.filament_color_id;
  if (colorId) return colorId;
  if (part.role) return `(filament not set — ${part.role})`;
  return "(filament not set)";
}

export type PrintGroupRow = {
  group_key: string;
  filament_key: string;
  filament_label: string;
  filament_hex: string | null;
  repo: string;
  folder: string;
  part_count: number;
  parts: string[];
  label: string;
  printer_id: string | null;
  suggested_printer_id: string | null;
  suggested_printer_name: string | null;
  warning: string | null;
};

export function makeGroupKey(filamentKey: string, repo: string, folder: string): string {
  return `${filamentKey}|${repo}|${folder}`;
}

export function buildPrintGroupRows(
  copies: PartCopy[],
  printers: PrinterMachine[],
  assignments: Record<string, string> = {},
): PrintGroupRow[] {
  if (!copies.length) return [];

  const [byPrinter] = assignPartsToPrinters(copies, printers);
  const nameById = Object.fromEntries(printers.map((p) => [p.id, p.name]));
  const copyPrinter: Record<string, string> = {};
  for (const [printerId, pcopies] of Object.entries(byPrinter)) {
    for (const copy of pcopies) {
      copyPrinter[`${copy.part.matchKey}:${copy.unit}`] = printerId;
    }
  }

  const filamentBuckets: Record<string, PartCopy[]> = {};
  for (const copy of copies) {
    const key = partFilamentKey(copy.part as MergePartExport);
    (filamentBuckets[key] ??= []).push(copy);
  }

  const rows: PrintGroupRow[] = [];
  const keys = Object.keys(filamentBuckets).sort((a, b) => {
    const au = a === "__unset__" ? 1 : 0;
    const bu = b === "__unset__" ? 1 : 0;
    if (au !== bu) return au - bu;
    return a.localeCompare(b);
  });

  for (const key of keys) {
    const fcopies = filamentBuckets[key];
    const sample = fcopies[0].part as MergePartExport;
    const label = partFilamentLabel(sample);
    const hexColor = sample.filamentHex ?? sample.filament_hex ?? null;

    const printerIds = new Set<string>();
    for (const copy of fcopies) {
      const pid = copyPrinter[`${copy.part.matchKey}:${copy.unit}`];
      if (pid) printerIds.add(pid);
    }
    let suggestedId: string | null = null;
    let printerName: string | null = null;
    if (printerIds.size === 1) {
      suggestedId = [...printerIds][0];
      printerName = nameById[suggestedId] ?? null;
    } else if (printerIds.size > 1) {
      printerName = [...printerIds].map((id) => nameById[id] ?? id).sort().join(", ");
    }

    const loaded = new Set(printers.flatMap((p) => [...loadedFilamentKeys(p)]));
    let warning: string | null = null;
    if (key === "__unset__") {
      const role = (sample.role || "").trim();
      warning = role
        ? `No filament on these parts (role ${role}) — assigned to ${printers[0]?.name ?? "the first printer"}.`
        : "Set filament on these parts on Plan.";
    } else if (printers.length && printerIds.size > 1) {
      warning = "Parts split across multiple printers.";
    } else if (printers.length && !loaded.has(key)) {
      const hint = printers[0]?.name;
      warning = hint
        ? `Assign ${label} to ${hint} or enable another printer.`
        : `No enabled printer has ${label} loaded.`;
    }
    const sourceBuckets: Record<string, Record<string, number>> = {};
    const partsByBucket: Record<string, string[]> = {};
    const usedNames: Record<string, Set<string>> = {};

    for (const copy of fcopies) {
      const part = copy.part;
      const repo = repoNameFromSourceLayer(part.sourceLayer);
      const folder = folderKeyFromRelativePath(part.relativePath);
      const bucketKey = `${repo}\0${folder}`;
      if (!usedNames[bucketKey]) usedNames[bucketKey] = new Set();
      const display = objectDisplayName(part.filename, copy.unit, usedNames[bucketKey]);
      sourceBuckets[bucketKey] ??= {};
      sourceBuckets[bucketKey][part.matchKey] = (sourceBuckets[bucketKey][part.matchKey] ?? 0) + 1;
      (partsByBucket[bucketKey] ??= []).push(display);
    }

    for (const bucketKey of Object.keys(sourceBuckets).sort()) {
      const [repo, folder] = bucketKey.split("\0");
      const counts = sourceBuckets[bucketKey];
      const partCount = Object.values(counts).reduce((a, b) => a + b, 0);
      const groupKey = makeGroupKey(key, repo, folder);
      const labelParts = [label, repo];
      if (folder && folder !== "(root)") labelParts.push(folder);
      rows.push({
        group_key: groupKey,
        filament_key: key,
        filament_label: label,
        filament_hex: hexColor,
        repo,
        folder,
        part_count: partCount,
        parts: partsByBucket[bucketKey] ?? [],
        label: labelParts.join(" · "),
        printer_id:
          assignments[groupKey] && nameById[assignments[groupKey]]
            ? assignments[groupKey]
            : null,
        suggested_printer_id: suggestedId,
        suggested_printer_name: printerName,
        warning,
      });
    }
  }

  rows.sort((a, b) =>
    a.filament_label.localeCompare(b.filament_label) ||
    a.repo.localeCompare(b.repo) ||
    a.folder.localeCompare(b.folder),
  );
  return rows;
}
