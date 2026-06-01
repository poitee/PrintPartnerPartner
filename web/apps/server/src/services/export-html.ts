import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { globalThumbnailPath } from "../lib/thumbnails.js";
import {
  exportPathForChecklist,
  folderKeyFromRelativePath,
  isFullyPrinted,
  type MergePart,
} from "@print-partner/domain";

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function repoSortKey(sourceLayer: string): [number, string] {
  const lower = sourceLayer.toLowerCase();
  return sourceLayer.startsWith("base:") ? [0, lower] : [1, lower];
}

export function exportProfileHtml(
  profileName: string,
  orderNumber: string | null,
  parts: MergePart[],
  exportsDir: string,
  profileId: number,
  completedByMatchKey: Record<string, boolean[]>,
  thumbsDir?: string,
): { path: string; partCount: number; thumbCount: number } {
  const outPath = exportPathForChecklist(profileName, exportsDir);
  mkdirSync(dirname(outPath), { recursive: true });

  const included = parts.filter((p) => p.included);

  const byRepo = new Map<string, Map<string, MergePart[]>>();
  for (const p of included) {
    const repoKey = p.sourceLayer || "unknown";
    const folder = folderKeyFromRelativePath(p.relativePath);
    if (!byRepo.has(repoKey)) byRepo.set(repoKey, new Map());
    const folders = byRepo.get(repoKey)!;
    if (!folders.has(folder)) folders.set(folder, []);
    folders.get(folder)!.push(p);
  }

  const generatedAt = new Date().toISOString();
  let thumbCount = 0;
  let body = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>${escapeHtml(profileName)} checklist</title>
<style>body{font-family:system-ui,sans-serif;margin:1.5rem;}table{border-collapse:collapse;width:100%;}th,td{border:1px solid #ccc;padding:.4rem .6rem;text-align:left;}
.swatch{display:inline-block;width:12px;height:12px;border-radius:50%;margin-right:.35rem;vertical-align:middle;}
.thumb{width:48px;height:48px;object-fit:contain;vertical-align:middle;margin-right:.35rem;}</style></head><body>`;
  body += `<h1>${escapeHtml(profileName)}</h1>`;
  if (orderNumber) body += `<p><strong>Order #</strong> ${escapeHtml(orderNumber)}</p>`;
  body += `<p>${included.length} part(s) · Generated ${escapeHtml(generatedAt)}</p>`;

  const repos = [...byRepo.entries()].sort((a, b) => {
    const ka = repoSortKey(a[0]);
    const kb = repoSortKey(b[0]);
    return ka[0] - kb[0] || ka[1].localeCompare(kb[1]);
  });

  for (const [repoLabel, folders] of repos) {
    body += `<h2>${escapeHtml(repoLabel)}</h2>`;
    for (const [folder, folderParts] of [...folders.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      body += `<h3>${escapeHtml(folder)}</h3><table><thead><tr><th>Part</th><th>Qty</th><th>Printed</th><th>Notes</th></tr></thead><tbody>`;
      for (const p of folderParts) {
        const qty = Math.max(1, p.quantityOverride ?? p.quantityAuto ?? 1);
        const units = completedByMatchKey[p.matchKey] ?? [];
        const row = {
          quantity_effective: qty,
          printed_count: units.filter(Boolean).length,
        };
        const done = isFullyPrinted(row);
        const hex = (p as MergePart & { filamentHex?: string | null }).filamentHex ?? "";
        let thumbHtml = "";
        if (thumbsDir && p.absolutePath) {
          const thumbPath = globalThumbnailPath(thumbsDir, p.absolutePath, p.role, hex);
          if (existsSync(thumbPath)) {
            const b64 = readFileSync(thumbPath).toString("base64");
            thumbHtml = `<img class="thumb" alt="" src="data:image/png;base64,${b64}"/>`;
            thumbCount += 1;
          }
        }
        body += `<tr><td>${thumbHtml}${hex ? `<span class="swatch" style="background:${escapeHtml(hex)}"></span>` : ""}${escapeHtml(p.filename)} <small>${escapeHtml(p.role)}</small></td>`;
        body += `<td>${qty}</td><td>${done ? "✓" : "—"}</td><td>${escapeHtml(p.notes ?? "")}</td></tr>`;
      }
      body += `</tbody></table>`;
    }
  }
  body += `<p class="no-print"><small>Print Partner · profile ${profileId}</small></p></body></html>`;
  writeFileSync(outPath, body, "utf8");
  return { path: outPath, partCount: included.length, thumbCount };
}
