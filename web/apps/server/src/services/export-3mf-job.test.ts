import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { unzipSync } from "fflate";
import { afterEach, describe, expect, it } from "vitest";
import type { MergePartExport, PrinterMachine } from "@print-partner/domain";
import type { AppRepository } from "../db/repository.js";
import { runExport3mfJob } from "./export-3mf-job.js";

const MINI_STL = `solid fixture
facet normal 0 0 1
outer loop
vertex 0 0 0
vertex 10 0 0
vertex 0 10 5
endloop
endfacet
endsolid fixture`;

describe("runExport3mfJob", () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
    dirs.length = 0;
  });

  function fixture(quantity = 1, completed: boolean[] = []) {
    const dir = mkdtempSync(join(tmpdir(), "pp-export-job-"));
    dirs.push(dir);
    const stlPath = join(dir, "bracket.stl");
    writeFileSync(stlPath, MINI_STL);
    const part: MergePartExport = {
      matchKey: "bracket.stl",
      relativePath: "parts/bracket.stl",
      filename: "bracket.stl",
      sourceLayer: "base:fixture",
      status: "included",
      role: "primary",
      quantityAuto: quantity,
      quantityEffective: quantity,
      partSlug: "bracket",
      included: true,
      quantityOverride: null,
      notes: "",
      geometrySame: null,
      absolutePath: stlPath,
    };
    return { dir, exportsDir: join(dir, "exports"), part, completed };
  }

  it("orchestrates a real 3MF export from the persisted printer and plate plan", () => {
    const { exportsDir, part, completed } = fixture(3);
    const printer = makePrinter("voron", "Voron");
    const repo = fakeRepo(
      "Fixture Kit",
      [part],
      completed,
      [printer],
      {
        enabled_printer_ids: ["voron"],
        plate_layout: {
          spacing_mm: 7,
          printers: [
            {
              printer_id: "voron",
              plates: [
                [
                  { match_key: "bracket.stl", unit: 1 },
                  { match_key: "bracket.stl", unit: 2 },
                ],
                [{ match_key: "bracket.stl", unit: 3 }],
              ],
              unassigned: [],
            },
          ],
          pool: [],
        },
        group_assignments: {},
        grouping_strategy: "location",
      },
    );

    const result = runExport3mfJob(repo, 42, exportsDir, { layout_mode: "per_plate" });

    expect(result).toMatchObject({
      object_count: 3,
      plate_count: 2,
      printer_summaries: ["Voron: 2 plate(s)"],
    });
    expect(result.paths).toHaveLength(2);
    expect(existsSync(result.primary_path)).toBe(true);
    expect(basename(result.primary_path)).toContain("voron");
    const model = unzipSync(readFileSync(result.primary_path))["3D/3dmodel.model"];
    const xml = new TextDecoder().decode(model);
    expect(xml).toContain('name="bracket.stl"');
    expect(xml).toContain('name="bracket.stl (2)"');
    // 10 mm part + persisted 7 mm spacing + 4 mm margin. The fallback path
    // uses 4 mm spacing and would place this vertex at x=18 instead.
    expect(xml).toContain('<vertex x="21"');
  });

  it("exports only unfinished copies through the real missing-only path", () => {
    const { exportsDir, part } = fixture(2, [true, false]);
    const repo = fakeRepo(
      "Missing Kit",
      [part],
      [true, false],
      [makePrinter("mk4", "MK4")],
      null,
    );

    const result = runExport3mfJob(repo, 42, exportsDir, {
      layout_mode: "per_plate",
      missing_only: true,
    });

    expect(result.object_count).toBe(1);
    const model = unzipSync(readFileSync(result.primary_path))["3D/3dmodel.model"];
    expect(new TextDecoder().decode(model)).toContain('name="bracket.stl (2)"');
  });

  it("honors a per-job printer override instead of the persisted enabled set", () => {
    const { exportsDir, part, completed } = fixture();
    const repo = fakeRepo(
      "Override Kit",
      [part],
      completed,
      [makePrinter("voron", "Voron"), makePrinter("mk4", "MK4")],
      {
        enabled_printer_ids: ["voron"],
        plate_layout: null,
        group_assignments: {},
        grouping_strategy: "location",
      },
    );

    const result = runExport3mfJob(repo, 42, exportsDir, {
      enabled_printer_ids: ["mk4"],
    });

    expect(result.printer_summaries).toEqual(["MK4: 1 plate(s)"]);
    expect(basename(result.primary_path)).toContain("mk4");
  });

  it("fails before export when no configured printer is enabled", () => {
    const { exportsDir, part, completed } = fixture();
    const repo = fakeRepo("No Printer Kit", [part], completed, [], null);

    expect(() => runExport3mfJob(repo, 42, exportsDir, {})).toThrow(
      "No printers configured. Add a printer in Settings.",
    );
  });
});

function makePrinter(id: string, name: string): PrinterMachine {
  return {
    id,
    name,
    bed_width_mm: 200,
    bed_depth_mm: 200,
    bed_height_mm: 200,
    margin_mm: 4,
    max_filament_slots: 1,
    loaded_filaments: [{ slot: 1, filament_color_id: null, label: "" }],
  };
}

function fakeRepo(
  profileName: string,
  parts: MergePartExport[],
  completedByMatchKey: boolean[],
  fleet: PrinterMachine[],
  plan: Record<string, unknown> | null,
): AppRepository {
  const settings = new Map<string, string>([
    ["printer.fleet", JSON.stringify(fleet)],
  ]);
  if (plan) settings.set("print_plan:42", JSON.stringify(plan));
  return {
    buildMergePartsForProfile: () => ({
      name: profileName,
      orderNumber: null,
      parts,
      completedByMatchKey: { "bracket.stl": completedByMatchKey },
    }),
    getSetting: (key: string) => settings.get(key) ?? null,
  } as unknown as AppRepository;
}
