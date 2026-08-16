import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createSelfHostPorts } from "../adapters/self-host/index.js";
import { invokeAssistantTool } from "./tools.js";
import { loadFleet, saveFleet } from "../services/printer-fleet.js";
import type { IntegrationPort } from "../integrations/store.js";
import type { PrinterHostStatus } from "@print-partner/contracts";

/**
 * Schema-v9-era print_jobs audit: end-to-end validation that get_farm_status
 * and get_print_stats (added on top of the print_jobs table) can read every
 * field the MCP tool contract promises, using representative sample data
 * (an idle printer, an actively printing printer, an offline printer, and a
 * mix of completed/failed/sent jobs across the lookback window).
 */
describe("print_jobs schema supports get_farm_status / get_print_stats", () => {
  let dataDir: string;
  let repo: NonNullable<ReturnType<typeof createSelfHostPorts>["repository"]>;

  beforeEach(async () => {
    dataDir = mkdtempSync(join(tmpdir(), "pp-farm-status-"));
    const ports = createSelfHostPorts(dataDir);
    await ports.db.connect();
    repo = ports.repository!;
  });

  afterEach(() => {
    rmSync(dataDir, { recursive: true, force: true });
  });

  it("get_farm_status reports printer state + active job for each fleet machine", async () => {
    saveFleet(repo, [
      {
        id: "trident-r2",
        name: "Trident R2 LDO",
        bed_width_mm: 250,
        bed_depth_mm: 250,
        bed_height_mm: 250,
        margin_mm: 4,
        max_filament_slots: 1,
        loaded_filaments: [{ slot: 1, filament_color_id: null, label: "" }],
        integration_id: "moonraker-trident",
      },
      {
        id: "prusa-xl",
        name: "Prusa XL",
        bed_width_mm: 360,
        bed_depth_mm: 360,
        bed_height_mm: 360,
        margin_mm: 4,
        max_filament_slots: 1,
        loaded_filaments: [{ slot: 1, filament_color_id: null, label: "" }],
        integration_id: "moonraker-xl",
      },
      {
        id: "coreone1",
        name: "CoreOne1",
        bed_width_mm: 250,
        bed_depth_mm: 220,
        bed_height_mm: 270,
        margin_mm: 4,
        max_filament_slots: 1,
        loaded_filaments: [{ slot: 1, filament_color_id: null, label: "" }],
        integration_id: null,
      },
    ]);
    expect(loadFleet(repo)).toHaveLength(3);

    const statuses: Record<string, PrinterHostStatus> = {
      "moonraker-trident": { state: "printing", filename: "plate_ldo.gcode", progress: 42 },
      "moonraker-xl": { state: "idle", filename: undefined },
    };
    const integrations: IntegrationPort = {
      getStatus: async (id: string) => {
        const s = statuses[id];
        if (!s) throw new Error("offline");
        return s;
      },
    } as unknown as IntegrationPort;

    const result = await invokeAssistantTool("get_farm_status", {}, { repo, integrations });
    const data = JSON.parse(result.content);

    expect(data.printer_count).toBe(3);
    expect(data.printers).toHaveLength(3);

    const trident = data.printers.find((p: { id: string }) => p.id === "trident-r2");
    expect(trident.state).toBe("printing");
    expect(trident.active_job).toBe("plate_ldo.gcode");

    const xl = data.printers.find((p: { id: string }) => p.id === "prusa-xl");
    expect(xl.state).toBe("idle");

    // CoreOne1 has no integration bound — surfaces as unknown, not a crash.
    const coreone = data.printers.find((p: { id: string }) => p.id === "coreone1");
    expect(coreone.state).toBe("unknown");

    expect(data.printing).toBe(1);
    expect(data.idle).toBe(1);
    // "unknown" (no integration bound) is bucketed together with "offline"
    // by get_farm_status's own aggregate logic — assert all 3 machines are
    // accounted for across the three buckets, none silently dropped.
    expect(data.idle + data.printing + data.offline).toBe(3);
  });

  it("get_print_stats aggregates print_jobs rows written via insertPrintJob", async () => {
    const plan = repo.createProfile("Trident Plate Run");

    const now = Date.now();
    const jobs = [
      { status: "completed", printerId: "trident-r2", material: "LDO PLA", filamentConsumedG: 42, hoursAgo: 1 },
      { status: "completed", printerId: "trident-r2", material: "LDO PLA", filamentConsumedG: 38, hoursAgo: 3 },
      { status: "completed", printerId: "prusa-xl", material: "PETG", filamentConsumedG: 55, hoursAgo: 6 },
      { status: "failed", printerId: "coreone1", material: "ABS", filamentConsumedG: 10, hoursAgo: 2 },
      { status: "sent", printerId: "trident-r2", material: "LDO PLA", filamentConsumedG: null, hoursAgo: 0.2 },
      // outside the default 8h lookback window — must NOT be counted
      { status: "completed", printerId: "prusa-xl", material: "PETG", filamentConsumedG: 999, hoursAgo: 30 },
    ];

    for (const j of jobs) {
      const at = new Date(now - j.hoursAgo * 3600 * 1000).toISOString();
      repo.insertPrintJob({
        id: randomUUID(),
        profileId: plan.id,
        printerId: j.printerId,
        material: j.material,
        status: j.status,
        filamentConsumedG: j.filamentConsumedG ?? undefined,
        at,
        completedAt: j.status === "completed" ? at : undefined,
      });
    }

    const result = await invokeAssistantTool("get_print_stats", {}, { repo });
    const data = JSON.parse(result.content);

    expect(data.window_hours).toBe(8);
    expect(data.plates_sent).toBe(5); // 6 total minus the 30h-old row outside the window
    expect(data.plates_completed).toBe(3);
    expect(data.plates_failed).toBe(1);
    expect(data.filament_consumed_g).toBe(42 + 38 + 55 + 10); // excludes the null and the out-of-window row
    expect(Array.isArray(data.active_plans)).toBe(true);
    expect(data.active_plans.some((p: { plan_id: number }) => p.plan_id === plan.id)).toBe(true);

    // custom window: widen to 48h to pick up the previously-excluded row
    const wide = JSON.parse(
      (await invokeAssistantTool("get_print_stats", { hours: 48 }, { repo })).content,
    );
    expect(wide.plates_sent).toBe(6);
    expect(wide.plates_completed).toBe(4);
  });

  it("get_print_stats does not error when print_jobs is empty (fresh v9+ schema)", async () => {
    const result = await invokeAssistantTool("get_print_stats", {}, { repo });
    const data = JSON.parse(result.content);
    expect(data.plates_sent).toBe(0);
    expect(data.plates_completed).toBe(0);
    expect(data.plates_failed).toBe(0);
    expect(data.filament_consumed_g).toBe(0);
  });

  it("get_farm_status does not error when fleet is empty", async () => {
    const result = await invokeAssistantTool("get_farm_status", {}, { repo });
    const data = JSON.parse(result.content);
    expect(data.printer_count).toBe(0);
    expect(data.printers).toEqual([]);
  });

  it("get_farm_status tolerates garbage/non-object input instead of throwing", async () => {
    // get_farm_status takes no parameters; a model that hallucinates args (or a
    // caller that passes null/an array/a primitive) must not crash the tool.
    for (const badInput of [null, undefined, "not-an-object", 42, ["x"]] as unknown as Record<
      string,
      unknown
    >[]) {
      const result = await invokeAssistantTool("get_farm_status", badInput, { repo });
      const data = JSON.parse(result.content);
      expect(data.printer_count).toBe(0);
      expect(data.error).toBeUndefined();
    }
  });

  it("get_print_stats rejects a non-positive or non-numeric hours value", async () => {
    for (const badHours of [0, -5, "not-a-number", NaN, Infinity, {}, []]) {
      const result = await invokeAssistantTool(
        "get_print_stats",
        { hours: badHours as unknown as number },
        { repo },
      );
      const data = JSON.parse(result.content);
      expect(data.error).toMatch(/hours must be a positive number/);
    }
  });

  it("get_print_stats rejects an absurdly large hours window", async () => {
    const result = await invokeAssistantTool(
      "get_print_stats",
      { hours: 24 * 365 }, // 1 year, well past the 90-day cap
      { repo },
    );
    const data = JSON.parse(result.content);
    expect(data.error).toMatch(/hours must be .* or less/);
  });

  it("get_print_stats accepts a numeric-string hours value", async () => {
    const result = await invokeAssistantTool("get_print_stats", { hours: "24" as unknown as number }, { repo });
    const data = JSON.parse(result.content);
    expect(data.error).toBeUndefined();
    expect(data.window_hours).toBe(24);
  });
});

