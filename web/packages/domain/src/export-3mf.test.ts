import { describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { unzipSync } from "fflate";
import {
  exportProfile3mf,
  objectDisplayName,
  sanitize3mfObjectName,
} from "./export-3mf.js";
import { profileExportDir } from "./export-paths.js";
import type { PrinterMachine } from "./filament-assigner.js";
import type { MergePartExport } from "./filament-assigner.js";

const MINI_STL = `solid t
  facet normal 0 0 1
    outer loop
      vertex 0 0 0
      vertex 10 0 0
      vertex 0 10 0
    endloop
  endfacet
endsolid t
`;

describe("export 3mf", () => {
  it("sanitizes object names", () => {
    expect(sanitize3mfObjectName("parts/bracket.stl")).toBe("bracket.stl");
    expect(sanitize3mfObjectName("weird<name>.stl")).toBe("weird_name_.stl");
  });

  it("names quantity copies", () => {
    const used = new Set<string>();
    expect(objectDisplayName("bracket.stl", 1, used)).toBe("bracket.stl");
    expect(objectDisplayName("bracket.stl", 2, used)).toBe("bracket.stl (2)");
  });

  it("does not hang when sanitized names exceed 200 chars", () => {
    const used = new Set<string>();
    const long = `${"a".repeat(220)}.stl`;
    const first = objectDisplayName(long, 1, used);
    expect(first.length).toBeLessThanOrEqual(200);
    const second = objectDisplayName(long, 1, used);
    expect(second).not.toBe(first);
    expect(second.length).toBeLessThanOrEqual(200);
    expect(second).toMatch(/\(\d+\)/);
    // Many collisions must still finish quickly.
    const t0 = Date.now();
    for (let i = 0; i < 50; i += 1) {
      objectDisplayName(long, 1, used);
    }
    expect(Date.now() - t0).toBeLessThan(500);
  });

  it("writes valid 3MF zip with model XML", () => {
    const dir = mkdtempSync(join(tmpdir(), "pp-3mf-"));
    const exportsDir = join(dir, "exports");
    const stl = join(dir, "bracket.stl");
    writeFileSync(stl, MINI_STL);
    const printer: PrinterMachine = {
      id: "p1",
      name: "Test",
      bed_width_mm: 200,
      bed_depth_mm: 200,
      bed_height_mm: 200,
      margin_mm: 4,
      max_filament_slots: 1,
      loaded_filaments: [{ slot: 1, filament_color_id: null, label: "" }],
    };
    const part: MergePartExport = {
      matchKey: "bracket.stl",
      relativePath: "bracket.stl",
      filename: "bracket.stl",
      sourceLayer: "base:repo",
      status: "included",
      role: "primary",
      quantityAuto: 1,
      partSlug: "bracket",
      included: true,
      quantityOverride: null,
      notes: "",
      geometrySame: null,
      absolutePath: stl,
      quantityEffective: 1,
    };
    const result = exportProfile3mf("Kit", [part], exportsDir, {
      enabled_printers: [printer],
      layout_mode: "per_plate",
    });
    expect(result.object_count).toBeGreaterThan(0);
    const outputDir = profileExportDir(exportsDir, "Kit", "3mf");
    const expectedPath = join(outputDir, "Kit_Test_plate_01.3mf");
    expect(result.primary_path).toBe(expectedPath);
    expect(existsSync(expectedPath)).toBe(true);
    const zip = readFileSync(expectedPath);
    const files = unzipSync(zip);
    const model = files["3D/3dmodel.model"];
    expect(model).toBeDefined();
    const xml = new TextDecoder().decode(model);
    expect(xml).toContain("<model");
    expect(xml).toContain("<vertex");
    expect(xml).toContain("<triangle");
    // Prusa/Orca object list reads object@name — must be the STL basename.
    expect(xml).toContain('name="bracket.stl"');
    expect(xml).toContain('partnumber="bracket.stl"');
    rmSync(dir, { recursive: true, force: true });
  });

  it("writes one 3MF per printer and a print_plan.json manifest", () => {
    const dir = mkdtempSync(join(tmpdir(), "pp-3mf-multi-"));
    const exportsDir = join(dir, "exports");
    const blackStl = join(dir, "bracket.stl");
    const redStl = join(dir, "clip.stl");
    writeFileSync(blackStl, MINI_STL);
    writeFileSync(redStl, MINI_STL);
    const voron: PrinterMachine = {
      id: "voron-350",
      name: "Voron 350",
      bed_width_mm: 200,
      bed_depth_mm: 200,
      bed_height_mm: 200,
      margin_mm: 4,
      max_filament_slots: 1,
      loaded_filaments: [{ slot: 1, filament_color_id: "asa-black", label: "ASA · Black" }],
    };
    const mk4: PrinterMachine = {
      id: "mk4",
      name: "MK4",
      bed_width_mm: 200,
      bed_depth_mm: 200,
      bed_height_mm: 200,
      margin_mm: 4,
      max_filament_slots: 1,
      loaded_filaments: [{ slot: 1, filament_color_id: "pla-red", label: "PLA · Red" }],
    };
    const black: MergePartExport = {
      matchKey: "bracket.stl",
      relativePath: "bracket.stl",
      filename: "bracket.stl",
      sourceLayer: "base:repo",
      status: "included",
      role: "primary",
      quantityAuto: 1,
      partSlug: "bracket",
      included: true,
      quantityOverride: null,
      notes: "",
      geometrySame: null,
      absolutePath: blackStl,
      quantityEffective: 1,
      filamentColorId: "asa-black",
      filamentDisplay: "ASA · Black",
    };
    const red: MergePartExport = {
      ...black,
      matchKey: "clip.stl",
      relativePath: "clip.stl",
      filename: "clip.stl",
      partSlug: "clip",
      absolutePath: redStl,
      filamentColorId: "pla-red",
      filamentDisplay: "PLA · Red",
    };
    const result = exportProfile3mf("MyKit", [black, red], exportsDir, {
      enabled_printers: [voron, mk4],
      layout_mode: "per_plate",
    });
    expect(result.plate_count).toBe(2);
    expect(result.paths).toHaveLength(2);
    expect(result.printer_summaries).toEqual(
      expect.arrayContaining(["Voron 350: 1 plate(s)", "MK4: 1 plate(s)"]),
    );
    const outputDir = profileExportDir(exportsDir, "MyKit", "3mf");
    expect(existsSync(join(outputDir, "MyKit_Voron_350_plate_01.3mf"))).toBe(true);
    expect(existsSync(join(outputDir, "MyKit_MK4_plate_01.3mf"))).toBe(true);
    const manifest = JSON.parse(readFileSync(join(outputDir, "print_plan.json"), "utf8")) as {
      kit: string;
      printers: Array<{
        id: string;
        name: string;
        bed_mm: [number, number];
        plates: Array<{ file: string; filaments: string[]; parts: string[] }>;
      }>;
    };
    expect(manifest.kit).toBe("MyKit");
    const voronEntry = manifest.printers.find((p) => p.id === "voron-350");
    expect(voronEntry).toMatchObject({
      name: "Voron 350",
      bed_mm: [200, 200],
    });
    expect(voronEntry?.plates[0]).toMatchObject({
      file: "MyKit_Voron_350_plate_01.3mf",
      filaments: ["ASA · Black"],
      parts: ["bracket.stl"],
    });
    const mk4Entry = manifest.printers.find((p) => p.id === "mk4");
    expect(mk4Entry?.plates[0]).toMatchObject({
      file: "MyKit_MK4_plate_01.3mf",
      filaments: ["PLA · Red"],
      parts: ["clip.stl"],
    });
    const voronZip = unzipSync(readFileSync(join(outputDir, "MyKit_Voron_350_plate_01.3mf")));
    const voronXml = new TextDecoder().decode(voronZip["3D/3dmodel.model"]);
    expect(voronXml).toContain('name="bracket.stl"');
    rmSync(dir, { recursive: true, force: true });
  });

  it("zips plate files with print_plan.json", () => {
    const dir = mkdtempSync(join(tmpdir(), "pp-3mf-zip-"));
    const exportsDir = join(dir, "exports");
    const stl = join(dir, "bracket.stl");
    writeFileSync(stl, MINI_STL);
    const printer: PrinterMachine = {
      id: "p1",
      name: "Test",
      bed_width_mm: 200,
      bed_depth_mm: 200,
      bed_height_mm: 200,
      margin_mm: 4,
      max_filament_slots: 1,
      loaded_filaments: [{ slot: 1, filament_color_id: null, label: "" }],
    };
    const part: MergePartExport = {
      matchKey: "bracket.stl",
      relativePath: "bracket.stl",
      filename: "bracket.stl",
      sourceLayer: "base:repo",
      status: "included",
      role: "primary",
      quantityAuto: 1,
      partSlug: "bracket",
      included: true,
      quantityOverride: null,
      notes: "",
      geometrySame: null,
      absolutePath: stl,
      quantityEffective: 1,
    };
    const result = exportProfile3mf("Kit", [part], exportsDir, {
      enabled_printers: [printer],
      layout_mode: "zip",
    });
    expect(result.primary_path.endsWith("Kit_plates.zip")).toBe(true);
    const zip = unzipSync(readFileSync(result.primary_path));
    expect(Object.keys(zip)).toEqual(
      expect.arrayContaining(["print_plan.json", "Kit_Test_plate_01.3mf"]),
    );
    rmSync(dir, { recursive: true, force: true });
  });

  it("errors in single_plate_only when more than one plate is needed", () => {
    const dir = mkdtempSync(join(tmpdir(), "pp-3mf-single-"));
    const exportsDir = join(dir, "exports");
    const a = join(dir, "a.stl");
    const b = join(dir, "b.stl");
    writeFileSync(a, MINI_STL);
    writeFileSync(b, MINI_STL);
    const printer: PrinterMachine = {
      id: "tiny",
      name: "Tiny",
      bed_width_mm: 20,
      bed_depth_mm: 20,
      bed_height_mm: 200,
      margin_mm: 4,
      max_filament_slots: 1,
      loaded_filaments: [{ slot: 1, filament_color_id: null, label: "" }],
    };
    const makePart = (filename: string, path: string): MergePartExport => ({
      matchKey: filename,
      relativePath: filename,
      filename,
      sourceLayer: "base:repo",
      status: "included",
      role: "primary",
      quantityAuto: 1,
      partSlug: filename.replace(".stl", ""),
      included: true,
      quantityOverride: null,
      notes: "",
      geometrySame: null,
      absolutePath: path,
      quantityEffective: 1,
    });
    const result = exportProfile3mf("Kit", [makePart("a.stl", a), makePart("b.stl", b)], exportsDir, {
      enabled_printers: [printer],
      layout_mode: "single_plate_only",
    });
    expect(result.paths).toEqual([]);
    expect(result.warnings.some((w) => /Single-plate export/.test(w))).toBe(true);
    rmSync(dir, { recursive: true, force: true });
  });

  it("writes one offset file and lists it in the manifest", () => {
    const dir = mkdtempSync(join(tmpdir(), "pp-3mf-offset-"));
    const exportsDir = join(dir, "exports");
    const stl = join(dir, "bracket.stl");
    writeFileSync(stl, MINI_STL);
    const printer: PrinterMachine = {
      id: "p1",
      name: "Test",
      bed_width_mm: 200,
      bed_depth_mm: 200,
      bed_height_mm: 200,
      margin_mm: 4,
      max_filament_slots: 1,
      loaded_filaments: [{ slot: 1, filament_color_id: null, label: "" }],
    };
    const part: MergePartExport = {
      matchKey: "bracket.stl",
      relativePath: "bracket.stl",
      filename: "bracket.stl",
      sourceLayer: "base:repo",
      status: "included",
      role: "primary",
      quantityAuto: 1,
      partSlug: "bracket",
      included: true,
      quantityOverride: null,
      notes: "",
      geometrySame: null,
      absolutePath: stl,
      quantityEffective: 1,
    };
    const result = exportProfile3mf("Kit", [part], exportsDir, {
      enabled_printers: [printer],
      layout_mode: "single_offset",
    });
    expect(result.paths).toHaveLength(1);
    expect(result.primary_path.endsWith("Kit.3mf")).toBe(true);
    const outputDir = profileExportDir(exportsDir, "Kit", "3mf");
    const manifest = JSON.parse(readFileSync(join(outputDir, "print_plan.json"), "utf8")) as {
      printers: Array<{ plates: Array<{ file: string }> }>;
    };
    expect(manifest.printers[0].plates[0].file).toBe("Kit.3mf");
    rmSync(dir, { recursive: true, force: true });
  });
});
