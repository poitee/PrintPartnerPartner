/**
 * End-to-end verification for the auto-slice flow.
 *
 * Unlike auto-slice-job.test.ts (which stubs the sidecar with an in-process
 * HTTP fake), this exercises PP's real code path against the REAL Python
 * slicer_sidecar service — three live uvicorn instances, one per backend,
 * each driving a fake slicer CLI that validates the argv and the full preset
 * schema it receives. The 3MF is produced by PP's real export-3mf job from a
 * real plan and real STL geometry: nothing between "plan in the DB" and
 * "gcode + PNG on disk" is mocked except the slicer binary itself, which is
 * not installable in this environment.
 *
 * Run:
 *   e2e/start_sidecars.sh <slicer_sidecar dir> [python]
 *   E2E_SIDECARS=1 npx vitest run src/services/auto-slice-e2e.test.ts
 *   e2e/stop_sidecars.sh
 *
 * Skipped by default so CI doesn't require the Python service.
 */
import { describe, expect, it } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { unzipSync } from "fflate";
import { getDb, SqliteDatabase } from "../db/client.js";
import { AppRepository } from "../db/repository.js";
import { createIntegrationPort } from "../integrations/store.js";
import { saveFleet } from "./printer-fleet.js";
import { runAutoSliceJob } from "./auto-slice-job.js";
import type { PrinterMachine } from "@print-partner/domain";

const SIDECARS = {
  orca: `http://127.0.0.1:${process.env.E2E_PORT_ORCA ?? "8321"}`,
  prusa: `http://127.0.0.1:${process.env.E2E_PORT_PRUSA ?? "8322"}`,
  bambu: `http://127.0.0.1:${process.env.E2E_PORT_BAMBU ?? "8323"}`,
} as const;

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** A real (tiny) binary STL so the 3MF export has actual geometry to pack. */
const TRIANGLE_STL = `solid bracket
  facet normal 0 0 1
    outer loop
      vertex 0 0 0
      vertex 20 0 0
      vertex 0 20 0
    endloop
  endfacet
  facet normal 0 0 -1
    outer loop
      vertex 0 0 10
      vertex 0 20 10
      vertex 20 0 10
    endloop
  endfacet
endsolid bracket
`;

function machine(id: string, name: string, integrationId: string): PrinterMachine {
  return {
    id,
    name,
    bed_width_mm: 250,
    bed_depth_mm: 250,
    bed_height_mm: 250,
    margin_mm: 4,
    max_filament_slots: 1,
    loaded_filaments: [{ slot: 1, filament_color_id: null, label: "" }],
    integration_id: integrationId,
  };
}

const maybe = process.env.E2E_SIDECARS ? describe : describe.skip;

maybe("auto-slice against the real slicer sidecar service", () => {
  it("slices a real plate export on all three slicers and stores gcode + thumbnails", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pp-auto-slice-e2e-"));
    const sqlite = new SqliteDatabase(dir);
    sqlite.connect();
    const repo = new AppRepository(getDb(sqlite), undefined, sqlite.reposDir);

    try {
      // --- a real plan over real STL geometry --------------------------------
      const repoPath = join(dir, "src");
      mkdirSync(join(repoPath, "parts"), { recursive: true });
      writeFileSync(join(repoPath, "parts", "bracket.stl"), TRIANGLE_STL);
      const source = repo.createSource({
        name: "Src",
        source_kind: "local",
        local_path: repoPath,
      });
      repo.updateSource(source.id, { local_path: repoPath });
      repo.updateImportRules(source.id, ["parts/"]);
      const plan = repo.createProfile("E2E Plan", source.id);
      repo.recomputeProfile(plan.id);

      const port = createIntegrationPort({ repo, getAdapter: () => undefined });
      const moonraker = port.create({
        type: "moonraker",
        name: "Voron",
        config: { url: "http://v" },
      });
      const prusalink = port.create({
        type: "prusalink",
        name: "XL",
        config: { url: "http://x" },
      });
      const bambu = port.create({ type: "bambu", name: "X1C", config: { host: "1.2.3.4" } });
      for (const [slicer, url] of Object.entries(SIDECARS)) {
        port.create({
          type: "slicer_sidecar",
          name: `sidecar-${slicer}`,
          config: { url, slicer, api: "v1" },
        });
      }

      const printers = [
        machine("p-voron", "Voron 350", moonraker.id),
        machine("p-xl", "Prusa XL", prusalink.id),
        machine("p-x1c", "Bambu X1C", bambu.id),
      ];
      saveFleet(repo, printers);

      // --- imported slicer profiles, in PP's own native key vocabulary -------
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const db = (sqlite as any).sqlite as import("better-sqlite3").Database;
      const now = new Date().toISOString();
      for (const [name, fmt, model] of [
        ["Voron 350", "orca", "Voron350"],
        ["Prusa XL", "prusa", "XL"],
        ["Bambu X1C", "bambu", "X1C"],
      ] as Array<[string, string, string]>) {
        db.prepare(
          `INSERT INTO printer_profiles (tenant_id, name, slicer_format, resolved_flat_config, imported_at)
           VALUES (?, ?, ?, ?, ?)`,
        ).run(
          "default",
          name,
          fmt,
          JSON.stringify({
            printer_model: model,
            nozzle_diameter_mm: 0.4,
            printable_height_mm: 250,
            retraction_length_mm: 0.8,
          }),
          now,
        );
      }
      // Process + filament profiles named after each printer so the
      // name-match ranking in pickProfileForPrinter selects them
      // deterministically over the bundled pp_native starters.
      for (const name of ["Voron 350", "Prusa XL", "Bambu X1C"]) {
        db.prepare(
          `INSERT INTO process_profiles (tenant_id, name, slicer_format, resolved_flat_config, imported_at)
           VALUES (?, ?, ?, ?, ?)`,
        ).run(
          "default",
          name,
          "pp_native",
          // No `thumbnails` here on purpose: PP has no field for it, so this is
          // exactly what an imported/starter process profile looks like. The
          // Prusa path must still come back with a thumbnail, which only works
          // because buildSettingsDocs defaults `thumbnails` into the INI —
          // fake-prusa-slicer (like the real binary) emits no thumbnail block
          // without it and the slice fails with slicer_output_parse_error.
          JSON.stringify({ layer_height: 0.2, perimeters: 3, fill_density: 0.2 }),
          now,
        );
        db.prepare(
          `INSERT INTO filament_profiles (tenant_id, name, material_type, resolved_flat_config, imported_at)
           VALUES (?, ?, ?, ?, ?)`,
        ).run(
          "default",
          name,
          "PLA",
          JSON.stringify({ nozzle_temp_c: 210, bed_temp_c: 60 }),
          now,
        );
      }

      // --- run the job: real 3MF export -> real sidecar -> stored artifacts --
      // One run per printer. PP's part→printer assignment sends every copy of
      // an unassigned-filament part to the first enabled printer, so enabling
      // all three at once would only ever exercise one slicer; enabling one at
      // a time gives each printer type a genuine plate export of its own.
      const plates: Array<
        Awaited<ReturnType<typeof runAutoSliceJob>>["plates"][number]
      > = [];
      for (const printer of printers) {
        const exportsDir = join(dir, "exports", printer.id);
        mkdirSync(exportsDir, { recursive: true });
        const result = await runAutoSliceJob(
          repo,
          exportsDir,
          { profile_id: plan.id, enabled_printer_ids: [printer.id], timeout_s: 60 },
          () => {},
        );
        if (result.failed_count > 0) {
          // Surface the sidecar's captured stderr — the whole point of the
          // error plumbing — so a harness failure is diagnosable.
          console.error(
            JSON.stringify({ warnings: result.warnings, plates: result.plates }, null, 2),
          );
        }
        expect(result.attempted_count).toBeGreaterThan(0);
        expect(result.failed_count).toBe(0);
        expect(result.ok).toBe(true);
        plates.push(...result.plates);
      }

      // The plates came from a REAL export, so assert the 3MF the job fed the
      // sidecar is genuine geometry rather than a hand-written stub.
      for (const plate of plates) {
        expect(existsSync(plate.plate_path)).toBe(true);
        const entries = Object.keys(unzipSync(new Uint8Array(readFileSync(plate.plate_path))));
        expect(entries.some((n) => n.endsWith("3dmodel.model"))).toBe(true);
      }

      // Every printer type reached its own slicer.
      const bySlicer = new Map(plates.map((p) => [p.slicer, p]));
      expect([...bySlicer.keys()].sort()).toEqual(["bambu", "orca", "prusa"]);
      expect(bySlicer.get("orca")!.printer_name).toBe("Voron 350");
      expect(bySlicer.get("prusa")!.printer_name).toBe("Prusa XL");
      expect(bySlicer.get("bambu")!.printer_name).toBe("Bambu X1C");

      for (const plate of plates) {
        // Acceptance: a gcode file saved locally, carrying real motion.
        expect(existsSync(plate.gcode_path!)).toBe(true);
        const gcode = readFileSync(plate.gcode_path!, "utf8");
        expect(gcode).toContain("G28");
        const flavour =
          plate.slicer === "prusa"
            ? "fake-prusa"
            : plate.slicer === "bambu"
              ? "fake-bambu"
              : "fake-orca";
        expect(gcode).toContain(flavour);

        // Acceptance: the settings PP resolved actually reached the CLI —
        // each fake echoes the preset values it parsed into the gcode.
        expect(gcode).toContain("; nozzle_diameter = 0.4");
        expect(gcode).toContain("; layer_height = 0.2");
        expect(gcode).toContain("; filament_type = PLA");

        // Acceptance: a thumbnail image saved locally, and it is a real PNG.
        expect(existsSync(plate.thumbnail_path!)).toBe(true);
        const png = readFileSync(plate.thumbnail_path!);
        expect(png.subarray(0, 8)).toEqual(PNG_SIGNATURE);
        expect(png.length).toBeGreaterThan(100);
        expect(plate.thumbnail_path).toContain("/thumbnails/");
      }

      expect(readFileSync(bySlicer.get("orca")!.gcode_path!, "utf8")).toContain("Voron350");
      expect(readFileSync(bySlicer.get("prusa")!.gcode_path!, "utf8")).toContain("XL");
      expect(readFileSync(bySlicer.get("bambu")!.gcode_path!, "utf8")).toContain("X1C");

      // Regression guard (t_a9af03d0): PrusaSlicer only writes the embedded
      // thumbnail block when `thumbnails` is in the loaded config, and no PP
      // profile carries that key — so the option has to be synthesized during
      // translation. If it is ever dropped again the fake CLI emits no
      // thumbnail, the sidecar 502s with slicer_output_parse_error, and the
      // failed_count assertion above fires; this pins the cause explicitly.
      const prusaGcode = readFileSync(bySlicer.get("prusa")!.gcode_path!, "utf8");
      expect(prusaGcode).toContain("; thumbnails = 220x124");
      expect(prusaGcode).toContain("; thumbnail begin 220x124");
      expect(prusaGcode).not.toContain("; thumbnails = <unset>");
    } finally {
      sqlite.close();
      rmSync(dir, { recursive: true, force: true });
    }
  }, 180_000);

  it("surfaces the real CLI's stderr when a preset is rejected", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pp-auto-slice-e2e-fail-"));
    const sqlite = new SqliteDatabase(dir);
    sqlite.connect();
    const repo = new AppRepository(getDb(sqlite), undefined, sqlite.reposDir);

    try {
      const repoPath = join(dir, "src");
      mkdirSync(join(repoPath, "parts"), { recursive: true });
      writeFileSync(join(repoPath, "parts", "bracket.stl"), TRIANGLE_STL);
      const source = repo.createSource({
        name: "Src",
        source_kind: "local",
        local_path: repoPath,
      });
      repo.updateSource(source.id, { local_path: repoPath });
      repo.updateImportRules(source.id, ["parts/"]);
      const plan = repo.createProfile("E2E Fail Plan", source.id);
      repo.recomputeProfile(plan.id);

      const port = createIntegrationPort({ repo, getAdapter: () => undefined });
      const moonraker = port.create({
        type: "moonraker",
        name: "Voron",
        config: { url: "http://v" },
      });
      port.create({
        type: "slicer_sidecar",
        name: "sidecar-orca",
        config: { url: SIDECARS.orca, slicer: "orca", api: "v1" },
      });
      const printers = [machine("p-voron", "Voron 350", moonraker.id)];
      saveFleet(repo, printers);

      // A printer profile with NO nozzle_diameter: OrcaSlicer rejects a machine
      // preset missing a required field (CLI_VALIDATE_ERROR), and the sidecar
      // must relay that CLI stderr all the way back to the plate result.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const db = (sqlite as any).sqlite as import("better-sqlite3").Database;
      db.prepare(
        `INSERT INTO printer_profiles (tenant_id, name, slicer_format, resolved_flat_config, imported_at)
         VALUES (?, ?, ?, ?, ?)`,
      ).run(
        "default",
        "Voron 350",
        "orca",
        JSON.stringify({ printer_model: "Voron350" }),
        new Date().toISOString(),
      );

      const exportsDir = join(dir, "exports");
      mkdirSync(exportsDir, { recursive: true });

      const result = await runAutoSliceJob(
        repo,
        exportsDir,
        { profile_id: plan.id, enabled_printer_ids: printers.map((p) => p.id), timeout_s: 60 },
        () => {},
      );

      expect(result.ok).toBe(false);
      expect(result.failed_count).toBeGreaterThan(0);
      const failed = result.plates.find((p) => p.status === "error")!;
      expect(failed.error_code).toBe("slicer_execution_failed");
      // The real cause, from the real CLI's stderr, via the real sidecar.
      expect(failed.stderr).toBeTruthy();
      expect(failed.stderr).toContain("nozzle_diameter");
      expect(failed.exit_code).toBe(51);
      // And it must be in the job's warning log, not only the structured field.
      expect(result.warnings.join("\n")).toContain("nozzle_diameter");
    } finally {
      sqlite.close();
      rmSync(dir, { recursive: true, force: true });
    }
  }, 180_000);
});
