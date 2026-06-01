import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { zipSync, strToU8 } from "fflate";
import type { PartCopy } from "./checkoff-missing.js";
import { quantityEffective } from "./merge.js";
import { assignPartsToPrinters, type MergePartExport, type PrinterMachine } from "./filament-assigner.js";
import { resolveMeshColor } from "./mesh-color.js";
import { packCopiesOnPrinter, type PlateLayout, type PlacedItem } from "./plate-packer.js";
import { resolveLayoutToPlates } from "./plate-plan.js";
import type { KitPlateLayout } from "./plate-plan.js";
import { translateMesh } from "./stl-mesh.js";
import { profileExportDir, safePlanSlug } from "./export-paths.js";

const INVALID_XML_CHARS = /[^\w\s.\-()+]/g;
const PLATE_GAP_MM = 20;

export type ExportLayoutMode = "per_plate" | "zip" | "single_offset" | "single_plate_only";

export type Export3mfOptions = {
  layout_mode?: ExportLayoutMode;
  spacing_mm?: number;
  enabled_printers?: PrinterMachine[];
  plate_layouts?: Array<[PrinterMachine, PlateLayout]> | null;
  missing_only?: boolean;
  completed_by_match_key?: Record<string, boolean[]> | null;
};

export type Export3mfResult = {
  primary_path: string;
  paths: string[];
  object_count: number;
  plate_count: number;
  warnings: string[];
  printer_summaries: string[];
};

export function sanitize3mfObjectName(name: string): string {
  const base = basename(name.trim() || "part.stl");
  const cleaned = base.replace(INVALID_XML_CHARS, "_");
  return cleaned.slice(0, 200) || "part.stl";
}

export function objectDisplayName(filename: string, unit: number, usedNames: Set<string>): string {
  const base = sanitize3mfObjectName(filename);
  let display = base;
  if (unit > 1) {
    const dot = base.lastIndexOf(".");
    const stem = dot >= 0 ? base.slice(0, dot) : base;
    const suffix = dot >= 0 ? base.slice(dot) : ".stl";
    display = sanitize3mfObjectName(`${stem}${suffix} (${unit})`);
  }
  if (!usedNames.has(display)) {
    usedNames.add(display);
    return display;
  }
  const dot = base.lastIndexOf(".");
  const stem = dot >= 0 ? base.slice(0, dot) : base;
  const suffix = dot >= 0 ? base.slice(dot) : ".stl";
  let n = 2;
  while (true) {
    const candidate = sanitize3mfObjectName(`${stem}${suffix} (${n})`);
    if (!usedNames.has(candidate)) {
      usedNames.add(candidate);
      return candidate;
    }
    n += 1;
  }
}

function filamentMaterialKey(part: MergePartExport): [string, string] {
  const label = (part.filamentDisplay ?? part.filament_display ?? "").trim() || part.role;
  const fid = part.filamentColorId ?? part.filament_color_id ?? label;
  return [fid, label];
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function hexToDisplayColor(hex: string): string {
  const h = hex.startsWith("#") ? hex.slice(1) : hex;
  if (h.length !== 6) return "#808080FF";
  return `#${h}FF`;
}

type MeshObjectSpec = {
  id: number;
  name: string;
  mesh: { vertices: Array<[number, number, number]>; faces: Array<[number, number, number]> };
  materialId: number;
  xOffset?: number;
};

function buildModelXml(objects: MeshObjectSpec[], materials: Map<string, { id: number; label: string; hex: string }>): string {
  const matEntries = [...materials.values()];
  let resources = "";
  for (const mat of matEntries) {
    resources += `    <basematerials id="${mat.id}">\n`;
    resources += `      <base name="${escapeXml(mat.label)}" displaycolor="${hexToDisplayColor(mat.hex)}"/>\n`;
    resources += `    </basematerials>\n`;
  }
  for (const obj of objects) {
    resources += `    <object id="${obj.id}" type="model">\n`;
    resources += `      <mesh>\n        <vertices>\n`;
    for (const [x, y, z] of obj.mesh.vertices) {
      resources += `          <vertex x="${x}" y="${y}" z="${z}"/>\n`;
    }
    resources += `        </vertices>\n        <triangles>\n`;
    for (const [v1, v2, v3] of obj.mesh.faces) {
      resources += `          <triangle v1="${v1}" v2="${v2}" v3="${v3}"/>\n`;
    }
    resources += `        </triangles>\n      </mesh>\n    </object>\n`;
  }

  let build = "";
  for (const obj of objects) {
    const pid = obj.materialId;
    build += `    <item objectid="${obj.id}"`;
    if (pid) build += ` pid="${pid}" pindex="1"`;
    build += `/>\n`;
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" xmlns:m="http://schemas.microsoft.com/3dmanufacturing/material/2015/02">
  <resources>
${resources}  </resources>
  <build>
${build}  </build>
</model>`;
}

function write3mfZip(outPath: string, modelXml: string): void {
  const modelBytes = strToU8(modelXml);
  const contentTypes = `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>
</Types>`;
  const rels = `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>
</Relationships>`;
  const plateMeta = JSON.stringify({
    plate_index: 1,
    object_ids: [],
    outside: false,
  });
  const sliceInfo = `<?xml version="1.0" encoding="UTF-8"?>
<config xmlns="http://schemas.bambulab.com/package/2021" version="1.0">
  <header>
    <printer>Bambu Lab X1</printer>
    <print_time>0</print_time>
  </header>
</config>`;
  const zipped = zipSync({
    "[Content_Types].xml": strToU8(contentTypes),
    "_rels/.rels": strToU8(rels),
    "3D/3dmodel.model": modelBytes,
    "Metadata/plate_1.json": strToU8(plateMeta),
    "Metadata/slice_info.config": strToU8(sliceInfo),
  });
  writeFileSync(outPath, zipped);
}

function itemsToObjects(
  items: PlacedItem[],
  usedNames: Set<string>,
  materialByKey: Map<string, { id: number; label: string; hex: string }>,
  xOffset = 0,
): MeshObjectSpec[] {
  const specs: MeshObjectSpec[] = [];
  let nextId = 2;
  let nextMatId = 10;
  for (const placed of items) {
    const part = placed.copy.part as MergePartExport;
    let mesh = placed.mesh;
    if (xOffset) mesh = translateMesh(mesh, xOffset, 0, 0);
    const displayName = objectDisplayName(part.filename, placed.copy.unit, usedNames);
    const [key, label] = filamentMaterialKey(part);
    let mat = materialByKey.get(key);
    if (!mat) {
      const hex = resolveMeshColor(part.role, part.filamentHex ?? part.filament_hex);
      mat = { id: nextMatId++, label, hex };
      materialByKey.set(key, mat);
    }
    specs.push({
      id: nextId++,
      name: displayName,
      mesh: { vertices: mesh.vertices, faces: mesh.faces },
      materialId: mat.id,
    });
  }
  return specs;
}

function writePlateFile(path: string, items: PlacedItem[], xOffset = 0): number {
  const usedNames = new Set<string>();
  const materialByKey = new Map<string, { id: number; label: string; hex: string }>();
  const objects = itemsToObjects(items, usedNames, materialByKey, xOffset);
  if (!objects.length) return 0;
  const xml = buildModelXml(objects, materialByKey);
  write3mfZip(path, xml);
  return objects.length;
}

export function exportProfile3mf(
  profileName: string,
  parts: MergePartExport[],
  exportsDir: string,
  options: Export3mfOptions = {},
): Export3mfResult {
  const opts = options;
  const layoutMode = opts.layout_mode ?? "per_plate";
  const spacingMm = opts.spacing_mm ?? 4;
  const safeProfile = safePlanSlug(profileName);
  const outputDir = profileExportDir(exportsDir, profileName, "3mf");
  mkdirSync(outputDir, { recursive: true });

  const included = parts.filter((p) => p.included);
  const missingPath = included.filter((p) => !p.absolutePath);
  const exportable = included.filter((p) => p.absolutePath);

  const warnings: string[] = missingPath.map(
    (p) => `Missing STL: ${p.relativePath} (${p.sourceLayer})`,
  );

  const copies: PartCopy[] = [];
  const completed = opts.completed_by_match_key ?? {};
  for (const part of exportable) {
    const qty = Math.max(1, part.quantityEffective ?? part.quantity_effective ?? quantityEffective(part));
    const units = completed[part.matchKey];
    for (let unit = 1; unit <= qty; unit++) {
      if (opts.missing_only) {
        const idx = unit - 1;
        if (units && idx < units.length && units[idx]) continue;
      }
      copies.push({ part, unit });
    }
  }
  if (opts.missing_only && !copies.length) {
    warnings.push("All included units are already marked printed in checkoff.");
  }

  const empty: Export3mfResult = {
    primary_path: join(outputDir, `${safeProfile}.3mf`),
    paths: [],
    object_count: 0,
    plate_count: 0,
    warnings,
    printer_summaries: [],
  };
  if (!copies.length) return empty;

  const printers = opts.enabled_printers ?? [];
  if (!printers.length) {
    warnings.push("No printers enabled. Configure printers on the Print tab.");
    return empty;
  }

  let allPlates: Array<[PrinterMachine, PlateLayout]> = [];
  if (opts.plate_layouts) {
    allPlates = opts.plate_layouts;
  } else {
    const [byPrinter, assignWarnings] = assignPartsToPrinters(copies, printers);
    warnings.push(...assignWarnings);
    for (const printer of printers) {
      const pcopies = byPrinter[printer.id] ?? [];
      if (!pcopies.length) continue;
      const [plates, packWarnings] = packCopiesOnPrinter(printer, pcopies, { spacing_mm: spacingMm });
      warnings.push(...packWarnings);
      for (const plate of plates) allPlates.push([printer, plate]);
    }
  }

  if (!allPlates.length) return empty;

  if (layoutMode === "single_plate_only") {
    const multi = printers.filter(
      (p) => allPlates.filter(([pr]) => pr.id === p.id).length > 1,
    ).length;
    if (multi > 0 || allPlates.length > 1) {
      warnings.push(
        "Single-plate export requires everything to fit on one bed. " +
          "Use per-plate or zip mode, or enable a larger printer.",
      );
      return empty;
    }
  }

  const paths: string[] = [];
  let objectCount = 0;

  if (layoutMode === "single_offset") {
    const usedNames = new Set<string>();
    const materialByKey = new Map<string, { id: number; label: string; hex: string }>();
    let xOffset = 0;
    const allObjects: MeshObjectSpec[] = [];
    for (const [printer, plate] of allPlates) {
      const objs = itemsToObjects(plate.items, usedNames, materialByKey, xOffset);
      allObjects.push(...objs);
      objectCount += objs.length;
      xOffset += printer.bed_width_mm + PLATE_GAP_MM;
    }
    const outPath = join(outputDir, `${safeProfile}.3mf`);
    if (allObjects.length) {
      write3mfZip(outPath, buildModelXml(allObjects, materialByKey));
      paths.push(outPath);
    }
  } else {
    for (const [printer, plate] of allPlates) {
      const slugPrinter = safePlanSlug(printer.name);
      const slugGroup = plate.group_label ? `_${safePlanSlug(plate.group_label).slice(0, 80)}` : "";
      const fname = plate.group_label
        ? `${safeProfile}_${slugPrinter}${slugGroup}_p${String(plate.index).padStart(2, "0")}.3mf`
        : `${safeProfile}_${slugPrinter}_plate_${String(plate.index).padStart(2, "0")}.3mf`;
      const outPath = join(outputDir, fname);
      const n = writePlateFile(outPath, plate.items);
      objectCount += n;
      if (n > 0) paths.push(outPath);
    }
  }

  const summaries: string[] = [];
  for (const printer of printers) {
    const printerPlates = allPlates.filter(([pr]) => pr.id === printer.id);
    if (!printerPlates.length) continue;
    summaries.push(`${printer.name}: ${printerPlates.length} plate(s)`);
  }

  const manifest = {
    kit: profileName,
    layout_mode: layoutMode,
    printers: summaries,
    warnings,
  };
  const manifestPath = join(outputDir, "print_plan.json");
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), "utf8");

  let primary = paths[0] ?? join(outputDir, `${safeProfile}.3mf`);
  if (layoutMode === "zip" && paths.length) {
    const zipEntries: Record<string, Uint8Array> = {
      "print_plan.json": strToU8(readFileSync(manifestPath, "utf8")),
    };
    for (const p of paths) {
      zipEntries[basename(p)] = readFileSync(p);
    }
    const zipPath = join(outputDir, `${safeProfile}_plates.zip`);
    writeFileSync(zipPath, zipSync(zipEntries));
    primary = zipPath;
  }

  return {
    primary_path: primary,
    paths,
    object_count: objectCount,
    plate_count: allPlates.length,
    warnings,
    printer_summaries: summaries,
  };
}

export function exportProfile3mfWithLayout(
  profileName: string,
  parts: MergePartExport[],
  exportsDir: string,
  printers: PrinterMachine[],
  copies: PartCopy[],
  plateLayout: KitPlateLayout | null,
  options: Omit<Export3mfOptions, "enabled_printers"> = {},
): Export3mfResult {
  let plateLayouts: Array<[PrinterMachine, PlateLayout]> | undefined;
  if (plateLayout && copies.length) {
    const [resolved] = resolveLayoutToPlates(plateLayout, printers, copies);
    plateLayouts = resolved;
  }
  return exportProfile3mf(profileName, parts, exportsDir, {
    ...options,
    enabled_printers: printers,
    plate_layouts: plateLayouts ?? options.plate_layouts ?? undefined,
    spacing_mm: options.spacing_mm ?? plateLayout?.spacing_mm ?? 4,
  });
}
