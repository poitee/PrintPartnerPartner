/**
 * Manual end-to-end verification for the auto-slice wiring: runs the real job
 * against the live sidecars and LEAVES the artifacts on disk so they can be
 * inspected with file(1)/xxd rather than only asserted in-process.
 *
 * Usage (after e2e/start_sidecars.sh):
 *   npx tsx e2e/verify_auto_slice.ts [outDir]
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { getDb, SqliteDatabase } from "../src/db/client.js";
import { AppRepository } from "../src/db/repository.js";
import { createIntegrationPort } from "../src/integrations/store.js";
import { saveFleet } from "../src/services/printer-fleet.js";
import { runAutoSliceJob } from "../src/services/auto-slice-job.js";
import type { PrinterMachine } from "@print-partner/domain";

const OUT = process.argv[2] ?? "/tmp/pp-auto-slice-verify";
const SIDECARS = {
  orca: `http://127.0.0.1:${process.env.E2E_PORT_ORCA ?? "8321"}`,
  prusa: `http://127.0.0.1:${process.env.E2E_PORT_PRUSA ?? "8322"}`,
  bambu: `http://127.0.0.1:${process.env.E2E_PORT_BAMBU ?? "8323"}`,
};

const STL = `solid bracket
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

mkdirSync(OUT, { recursive: true });
const sqlite = new SqliteDatabase(OUT);
sqlite.connect();
const repo = new AppRepository(getDb(sqlite), undefined, sqlite.reposDir);

const repoPath = join(OUT, "src");
mkdirSync(join(repoPath, "parts"), { recursive: true });
writeFileSync(join(repoPath, "parts", "bracket.stl"), STL);
const source = repo.createSource({ name: "Src", source_kind: "local", local_path: repoPath });
repo.updateSource(source.id, { local_path: repoPath });
repo.updateImportRules(source.id, ["parts/"]);
const plan = repo.createProfile("Verify Plan", source.id);
repo.recomputeProfile(plan.id);

const port = createIntegrationPort({ repo, getAdapter: () => undefined });
const moonraker = port.create({ type: "moonraker", name: "Voron", config: { url: "http://v" } });
const prusalink = port.create({ type: "prusalink", name: "XL", config: { url: "http://x" } });
const bambu = port.create({ type: "bambu", name: "X1C", config: { host: "1.2.3.4" } });
for (const [slicer, url] of Object.entries(SIDECARS)) {
  port.create({ type: "slicer_sidecar", name: `sidecar-${slicer}`, config: { url, slicer, api: "v1" } });
}

const printers = [
  machine("p-voron", "Voron 350", moonraker.id),
  machine("p-xl", "Prusa XL", prusalink.id),
  machine("p-x1c", "Bambu X1C", bambu.id),
];
saveFleet(repo, printers);

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
  db.prepare(
    `INSERT INTO process_profiles (tenant_id, name, slicer_format, resolved_flat_config, imported_at)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(
    "default",
    name,
    "pp_native",
    JSON.stringify({ layer_height: 0.2, perimeters: 3, fill_density: 0.2 }),
    now,
  );
  db.prepare(
    `INSERT INTO filament_profiles (tenant_id, name, material_type, resolved_flat_config, imported_at)
     VALUES (?, ?, ?, ?, ?)`,
  ).run("default", name, "PLA", JSON.stringify({ nozzle_temp_c: 210, bed_temp_c: 60 }), now);
}

const artifacts: Array<Record<string, unknown>> = [];
for (const printer of printers) {
  const exportsDir = join(OUT, "exports", printer.id);
  mkdirSync(exportsDir, { recursive: true });
  const result = await runAutoSliceJob(
    repo,
    exportsDir,
    { profile_id: plan.id, enabled_printer_ids: [printer.id], timeout_s: 60 },
    (patch) => {
      if (patch.message) console.log(`  [${printer.name}] ${patch.message}`);
    },
  );
  for (const w of result.warnings) console.log(`  warn: ${w}`);
  for (const p of result.plates) {
    artifacts.push({
      printer: p.printer_name,
      slicer: p.slicer,
      status: p.status,
      error: p.error,
      error_code: p.error_code,
      exit_code: p.exit_code,
      stderr: p.stderr,
      plate_3mf: p.plate_path,
      plate_3mf_bytes: existsSync(p.plate_path) ? statSync(p.plate_path).size : null,
      gcode: p.gcode_path,
      gcode_bytes: p.gcode_path && existsSync(p.gcode_path) ? statSync(p.gcode_path).size : null,
      gcode_head: p.gcode_path && existsSync(p.gcode_path)
        ? readFileSync(p.gcode_path, "utf8").split("\n").slice(0, 6)
        : null,
      thumbnail: p.thumbnail_path,
      thumbnail_bytes:
        p.thumbnail_path && existsSync(p.thumbnail_path) ? statSync(p.thumbnail_path).size : null,
    });
  }
}

sqlite.close();
console.log(JSON.stringify(artifacts, null, 2));
console.log(`\nartifacts left in ${OUT}`);
