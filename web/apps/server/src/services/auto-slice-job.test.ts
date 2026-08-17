import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { getDb, SqliteDatabase } from "../db/client.js";
import { AppRepository } from "../db/repository.js";
import { createIntegrationPort } from "../integrations/store.js";
import { saveFleet } from "./printer-fleet.js";
import type { PrinterMachine } from "@print-partner/domain";

// The 3MF export itself is covered by packages/domain/src/export-3mf.test.ts;
// here we stub it so the test can focus on routing + sidecar + storage.
const exportedPlates: { paths: string[]; warnings: string[] } = { paths: [], warnings: [] };
vi.mock("./export-3mf-job.js", () => ({
  runExport3mfJob: () => ({
    primary_path: exportedPlates.paths[0] ?? "",
    paths: exportedPlates.paths,
    object_count: exportedPlates.paths.length,
    plate_count: exportedPlates.paths.length,
    warnings: exportedPlates.warnings,
    printer_summaries: [],
  }),
}));

const { runAutoSliceJob, autoSliceJobMessage } = await import("./auto-slice-job.js");

const GCODE_BY_SLICER: Record<string, string> = {
  orca: "; ORCA\nG28\nG1 X1 Y1\n",
  prusa: "; PRUSA\nG28\nG1 X2 Y2\n",
  bambu: "; BAMBU\nG28\nG1 X3 Y3\n",
};
// 1x1 transparent PNG.
const PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

type SidecarRequest = {
  slicer: string;
  configKeys: string[];
  filename: string;
  rawBody: string;
  /** Parsed resolved_flat_configs, so tests can assert the exact documents sent. */
  configs: Record<string, Record<string, unknown>>;
};

let server: Server;
let sidecarUrl: string;
let requests: SidecarRequest[] = [];
/** Per-slicer override: return an error envelope instead of gcode. */
let failFor: Record<
  string,
  { status: number; code: string; message: string; details?: Record<string, unknown> }
> = {};

/** Crude multipart field reader — enough to assert what PP actually sent. */
function readField(body: string, name: string): string | null {
  const marker = `name="${name}"`;
  const at = body.indexOf(marker);
  if (at < 0) return null;
  const start = body.indexOf("\r\n\r\n", at);
  if (start < 0) return null;
  const end = body.indexOf("\r\n------", start + 4);
  return body.slice(start + 4, end < 0 ? undefined : end);
}

beforeAll(async () => {
  server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      const body = Buffer.concat(chunks).toString("latin1");
      if (req.url === "/healthz") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
        return;
      }
      const slicer = readField(body, "slicer") ?? "";
      const configsRaw = readField(body, "resolved_flat_configs") ?? "{}";
      const filenameMatch = /name="file"; filename="([^"]*)"/.exec(body);
      let configs: Record<string, Record<string, unknown>>;
      try {
        configs = JSON.parse(configsRaw) as Record<string, Record<string, unknown>>;
      } catch {
        configs = {};
      }
      requests.push({
        slicer,
        configKeys: Object.keys(configs),
        configs,
        filename: filenameMatch?.[1] ?? "",
        rawBody: body,
      });

      const failure = failFor[slicer];
      if (failure) {
        res.writeHead(failure.status, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            ok: false,
            error: {
              code: failure.code,
              message: failure.message,
              details: failure.details ?? {},
            },
          }),
        );
        return;
      }

      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          ok: true,
          meta: { slicer, stub: false, duration_ms: 5, warnings: [] },
          gcode_filename: "plate_1.gcode",
          gcode_base64: Buffer.from(GCODE_BY_SLICER[slicer] ?? "; ?\n").toString("base64"),
          thumbnail_filename: "plate_1.png",
          thumbnail_base64: PNG_B64,
        }),
      );
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  sidecarUrl = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  requests = [];
  failFor = {};
  exportedPlates.paths = [];
  exportedPlates.warnings = [];
});

function machine(id: string, name: string, integrationId: string | null): PrinterMachine {
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

type Ctx = {
  repo: AppRepository;
  exportsDir: string;
  dir: string;
  sqlite: SqliteDatabase;
  planName: string;
};

/**
 * Full fixture: a plan, a fleet of one Klipper + one PrusaXL + one Bambu
 * printer each bound to its integration type, a sidecar integration per
 * slicer, imported slicer profiles, and three plate 3MFs on disk.
 */
async function withFixture(fn: (ctx: Ctx) => Promise<void>): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), "pp-auto-slice-"));
  const sqlite = new SqliteDatabase(dir);
  sqlite.connect();
  const repo = new AppRepository(getDb(sqlite), undefined, sqlite.reposDir);

  const repoPath = join(dir, "src-repo");
  mkdirSync(join(repoPath, "parts"), { recursive: true });
  writeFileSync(join(repoPath, "parts", "bracket.stl"), "solid x\nendsolid x\n");
  const source = repo.createSource({ name: "Src", source_kind: "local", local_path: repoPath });
  repo.updateSource(source.id, { local_path: repoPath });
  repo.updateImportRules(source.id, ["parts/"]);
  const plan = repo.createProfile("Auto Slice Plan", source.id);
  repo.recomputeProfile(plan.id);

  const port = createIntegrationPort({ repo, getAdapter: () => undefined });
  const moonraker = port.create({ type: "moonraker", name: "Voron host", config: { url: "http://voron" } });
  const prusalink = port.create({ type: "prusalink", name: "XL host", config: { url: "http://xl" } });
  const bambu = port.create({ type: "bambu", name: "X1C host", config: { host: "1.2.3.4" } });
  for (const slicer of ["orca", "prusa", "bambu"]) {
    port.create({
      type: "slicer_sidecar",
      name: `sidecar-${slicer}`,
      config: { url: sidecarUrl, slicer, api: "v1" },
    });
  }

  saveFleet(repo, [
    machine("p-voron", "Voron 350", moonraker.id),
    machine("p-xl", "Prusa XL", prusalink.id),
    machine("p-x1c", "Bambu X1C", bambu.id),
  ]);

  // Imported slicer profiles, one printer profile per dialect. The configs are
  // PP-native (nozzle_diameter_mm, retraction_length_mm, …) — the same shape
  // the bundled starter profiles use — so the tests can assert that the job
  // sends the *translated* slicer-schema documents and not these raw docs.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = (sqlite as any).sqlite as import("better-sqlite3").Database;
  const now = new Date().toISOString();
  const ppNativeMachine = (model: string): string =>
    JSON.stringify({
      printer_model: model,
      nozzle_diameter_mm: 0.4,
      retraction_length_mm: 0.8,
      printable_height_mm: 250,
    });
  for (const [name, fmt, cfg] of [
    ["Voron 350", "orca", ppNativeMachine("Voron350")],
    ["Prusa XL", "prusa", ppNativeMachine("XL")],
    ["Bambu X1C", "bambu", ppNativeMachine("X1C")],
  ] as Array<[string, string, string]>) {
    db.prepare(
      `INSERT INTO printer_profiles (tenant_id, name, slicer_format, resolved_flat_config, imported_at)
       VALUES (?, ?, ?, ?, ?)`,
    ).run("default", name, fmt, cfg, now);
  }

  // Plate 3MFs named the way export-3mf.ts names them.
  const plateDir = join(dir, "plates");
  mkdirSync(plateDir, { recursive: true });
  exportedPlates.paths = [
    join(plateDir, "Auto_Slice_Plan_Voron_350_plate_01.3mf"),
    join(plateDir, "Auto_Slice_Plan_Prusa_XL_plate_02.3mf"),
    join(plateDir, "Auto_Slice_Plan_Bambu_X1C_plate_03.3mf"),
  ];
  for (const p of exportedPlates.paths) writeFileSync(p, Buffer.from([0x50, 0x4b, 0x03, 0x04]));

  const exportsDir = join(dir, "exports");
  mkdirSync(exportsDir, { recursive: true });

  try {
    await fn({ repo, exportsDir, dir, sqlite, planName: "Auto Slice Plan" });
  } finally {
    sqlite.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("runAutoSliceJob", () => {
  it("routes each printer type to its slicer and stores gcode + plate_N.png", async () => {
    await withFixture(async ({ repo, exportsDir }) => {
      const result = await runAutoSliceJob(repo, exportsDir, { profile_id: 1 }, () => {});

      expect(result.ok).toBe(true);
      expect(result.attempted_count).toBe(3);
      expect(result.plate_count).toBe(3);
      expect(result.failed_count).toBe(0);

      // Acceptance: correct slicer per printer type.
      expect(result.plates.map((p) => [p.printer_name, p.slicer])).toEqual([
        ["Voron 350", "orca"],
        ["Prusa XL", "prusa"],
        ["Bambu X1C", "bambu"],
      ]);
      expect(requests.map((r) => r.slicer)).toEqual(["orca", "prusa", "bambu"]);

      // Acceptance: the settings sent are the *slicer-shaped* documents, not
      // PP's raw native configs. resolveSlicerAndSettings translates key names
      // and adds the profile envelope; sending the raw docs would make the CLI
      // abort on an unknown option.
      for (const req of requests) {
        expect(req.configKeys).toContain("machine");
        expect(req.configKeys).toContain("process");
        expect(req.configKeys).toContain("filament");
        // PP-native key names must not survive to the wire.
        expect(req.configs.machine!.nozzle_diameter_mm).toBeUndefined();
        expect(req.configs.machine!.retraction_length_mm).toBeUndefined();
      }

      const [orcaReq, prusaReq, bambuReq] = requests as [
        SidecarRequest,
        SidecarRequest,
        SidecarRequest,
      ];

      // Orca/Bambu: JSON schema — per-extruder values are string arrays and the
      // preset carries the envelope + compatible_printers link.
      for (const req of [orcaReq, bambuReq]) {
        expect(req.configs.machine!.nozzle_diameter).toEqual(["0.4"]);
        expect(req.configs.machine!.type).toBe("machine");
        expect(req.configs.machine!.instantiation).toBe("true");
        // printable_area is synthesized from the fleet printer's bed size.
        expect(req.configs.machine!.printable_area).toEqual([
          "0x0",
          "250x0",
          "250x250",
          "0x250",
        ]);
        expect(req.configs.process!.compatible_printers).toEqual([req.configs.machine!.name]);
        expect(req.configs.filament!.filament_type).toBeDefined();
      }
      expect(orcaReq.configs.machine!.printer_model).toBe("Voron350");
      expect(bambuReq.configs.machine!.printer_model).toBe("X1C");

      // PrusaSlicer: INI dialect key names (retract_length, not
      // retraction_length), scalars rather than per-extruder arrays.
      expect(prusaReq.configs.machine!.printer_model).toBe("XL");
      expect(prusaReq.configs.machine!.retract_length).toBe("0.8");
      expect(prusaReq.configs.machine!.max_print_height).toBe("250");
      expect(prusaReq.configs.machine!.retraction_length).toBeUndefined();
      expect(prusaReq.configs.process!.perimeters).toBeDefined();

      // Acceptance: gcode + thumbnail stored, and the bytes are the ones the
      // matching slicer returned (not another slicer's output).
      for (const plate of result.plates) {
        expect(plate.status).toBe("ok");
        expect(plate.gcode_path).toBeTruthy();
        expect(existsSync(plate.gcode_path!)).toBe(true);
        expect(readFileSync(plate.gcode_path!, "utf8")).toBe(GCODE_BY_SLICER[plate.slicer]);

        expect(plate.thumbnail_path).toBeTruthy();
        expect(existsSync(plate.thumbnail_path!)).toBe(true);
        expect(readFileSync(plate.thumbnail_path!).subarray(0, 8)).toEqual(PNG_SIGNATURE);
        expect(plate.thumbnail_path).toContain("/thumbnails/");
      }

      // Plate index comes from the exported filename, not loop position.
      expect(result.plates.map((p) => p.plate_index)).toEqual([1, 2, 3]);
      expect(result.plates[1]!.gcode_path).toContain("plate_02.gcode");
    });
  });

  it("keeps going and reports per-plate failures when one slicer fails", async () => {
    await withFixture(async ({ repo, exportsDir }) => {
      failFor.prusa = {
        status: 502,
        code: "slicer_execution_failed",
        message: "prusa-slicer exited with code 1.",
      };

      const result = await runAutoSliceJob(repo, exportsDir, { profile_id: 1 }, () => {});

      expect(result.ok).toBe(false);
      expect(result.attempted_count).toBe(3);
      expect(result.plate_count).toBe(2);
      expect(result.failed_count).toBe(1);

      const failedPlate = result.plates.find((p) => p.status === "error")!;
      expect(failedPlate.slicer).toBe("prusa");
      expect(failedPlate.error_code).toBe("slicer_execution_failed");
      expect(failedPlate.error).toContain("prusa-slicer exited");
      expect(failedPlate.gcode_path).toBeNull();
      // The other two still produced files.
      for (const ok of result.plates.filter((p) => p.status === "ok")) {
        expect(existsSync(ok.gcode_path!)).toBe(true);
      }
      expect(autoSliceJobMessage(result)).toBe("Sliced 2 of 3 plate(s) — 1 failed");
    });
  });

  it("surfaces the slicer CLI's stderr and exit code on an execution failure", async () => {
    await withFixture(async ({ repo, exportsDir }) => {
      const STDERR = [
        "[warning] loading config",
        'Error: unknown config option "wall_loops"',
        "Slicing aborted.",
      ].join("\n");
      failFor.orca = {
        status: 502,
        code: "slicer_execution_failed",
        // The generic message alone never names the cause — the stderr does.
        message: "orca-slicer exited with code 1.",
        details: { exit_code: 1, stderr: STDERR, cmd: ["orca-slicer", "--slice", "0"] },
      };

      const result = await runAutoSliceJob(repo, exportsDir, { profile_id: 1 }, () => {});

      const failed = result.plates.find((p) => p.status === "error")!;
      expect(failed.slicer).toBe("orca");
      expect(failed.error_code).toBe("slicer_execution_failed");
      expect(failed.exit_code).toBe(1);
      expect(failed.stderr).toBe(STDERR);
      // The cause must also reach the job's warning log, not just the field.
      const warning = result.warnings.find((w) => w.includes("Plate 1"))!;
      expect(warning).toContain('unknown config option "wall_loops"');
      expect(warning).toContain("Slicing aborted.");
    });
  });

  it("leaves stderr/exit_code null for a non-CLI failure and for success", async () => {
    await withFixture(async ({ repo, exportsDir }) => {
      failFor.orca = {
        status: 504,
        code: "slicer_timeout",
        message: "orca-slicer did not finish within 300s.",
      };

      const result = await runAutoSliceJob(repo, exportsDir, { profile_id: 1 }, () => {});

      const timedOut = result.plates.find((p) => p.error_code === "slicer_timeout")!;
      expect(timedOut.stderr).toBeNull();
      expect(timedOut.exit_code).toBeNull();
      for (const ok of result.plates.filter((p) => p.status === "ok")) {
        expect(ok.stderr).toBeNull();
        expect(ok.exit_code).toBeNull();
      }
    });
  });

  it("cleans up the temp settings dirs it wrote for each printer", async () => {
    await withFixture(async ({ repo, exportsDir }) => {
      const before = new Set(
        readdirSync(tmpdir()).filter((n) => n.startsWith("pp-slice-")),
      );

      const result = await runAutoSliceJob(repo, exportsDir, { profile_id: 1 }, () => {});
      expect(result.plate_count).toBe(3);

      const after = readdirSync(tmpdir()).filter(
        (n) => n.startsWith("pp-slice-") && !before.has(n),
      );
      expect(after).toEqual([]);
    });
  });

  it("fails the plate (never mis-routes) when no sidecar runs the needed slicer", async () => {
    await withFixture(async ({ repo, exportsDir }) => {
      // Drop the prusa sidecar; the XL plate must NOT silently slice on Orca.
      const port = createIntegrationPort({ repo, getAdapter: () => undefined });
      const prusaSidecar = port.list().find((i) => i.config.slicer === "prusa")!;
      port.delete(prusaSidecar.id);

      const result = await runAutoSliceJob(repo, exportsDir, { profile_id: 1 }, () => {});

      expect(result.failed_count).toBe(1);
      const failed = result.plates.find((p) => p.status === "error")!;
      expect(failed.slicer).toBe("prusa");
      expect(failed.error_code).toBe("no_sidecar");
      // Only orca and bambu were actually contacted.
      expect(requests.map((r) => r.slicer).sort()).toEqual(["bambu", "orca"]);
    });
  });

  it("reports cleanly when the export produced no plates", async () => {
    await withFixture(async ({ repo, exportsDir }) => {
      exportedPlates.paths = [];
      const result = await runAutoSliceJob(repo, exportsDir, { profile_id: 1 }, () => {});
      expect(result.ok).toBe(false);
      expect(result.attempted_count).toBe(0);
      expect(result.warnings).toContain("No plate files were exported.");
      expect(autoSliceJobMessage(result)).toContain("No plate files were exported");
    });
  });

  it("resolves each printer's settings once, not once per plate", async () => {
    await withFixture(async ({ repo, exportsDir }) => {
      // Two plates for the same Voron printer.
      const plateDir = join(exportsDir, "..", "plates");
      const extra = join(plateDir, "Auto_Slice_Plan_Voron_350_plate_04.3mf");
      writeFileSync(extra, Buffer.from([0x50, 0x4b, 0x03, 0x04]));
      exportedPlates.paths = [exportedPlates.paths[0]!, extra];

      const spy = vi.spyOn(repo, "listSlicerPrinterProfiles");
      const result = await runAutoSliceJob(repo, exportsDir, { profile_id: 1 }, () => {});
      expect(result.plate_count).toBe(2);
      expect(spy).toHaveBeenCalledTimes(1);
      spy.mockRestore();
    });
  });
});

describe("autoSliceJobMessage", () => {
  it("distinguishes total failure, partial success, and clean success", () => {
    expect(autoSliceJobMessage({ plate_count: 0, attempted_count: 3, failed_count: 3 })).toContain(
      "All 3 plate(s) failed",
    );
    expect(autoSliceJobMessage({ plate_count: 1, attempted_count: 3, failed_count: 2 })).toBe(
      "Sliced 1 of 3 plate(s) — 2 failed",
    );
    expect(autoSliceJobMessage({ plate_count: 3, attempted_count: 3, failed_count: 0 })).toBe(
      "Sliced 3 plate(s)",
    );
  });
});
