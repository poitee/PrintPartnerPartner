import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { getDb, SqliteDatabase } from "../db/client.js";
import { AppRepository } from "../db/repository.js";
import {
  createPrinterCheckoffLink,
  getPrinterCheckoffLink,
} from "./printer-checkoff-store.js";

function openRepo() {
  const dir = mkdtempSync(join(tmpdir(), "pp-checkoff-store-"));
  const sqlite = new SqliteDatabase(dir);
  sqlite.connect();
  const repo = new AppRepository(getDb(sqlite), undefined, sqlite.reposDir);
  return { dir, sqlite, repo };
}

function closeRepo(dir: string, sqlite: SqliteDatabase) {
  sqlite.close();
  rmSync(dir, { recursive: true, force: true });
}

describe("printer-checkoff-store plate revision binding", () => {
  it("round-trips plate_revision_id with the Printer job mapping", () => {
    const { dir, sqlite, repo } = openRepo();
    try {
      const created = createPrinterCheckoffLink(repo, {
        profile_id: 7,
        integration_id: "int-moon",
        printer_id: "printer-one",
        host_name: "Printer One",
        filename: "plate-one.gcode",
        units: [{ part_id: 11, unit_index: 0 }],
        plate_revision_id: 19,
      });
      expect(created?.plate_revision_id).toBe(19);

      const loaded = getPrinterCheckoffLink(repo, created!.id);
      expect(loaded?.plate_revision_id).toBe(19);
      expect(loaded?.units).toEqual([{ part_id: 11, unit_index: 0 }]);
    } finally {
      closeRepo(dir, sqlite);
    }
  });

  it("round-trips the Object-name mapping used for each Progress unit", () => {
    const { dir, sqlite, repo } = openRepo();
    try {
      const created = createPrinterCheckoffLink(repo, {
        profile_id: 7,
        integration_id: "int-moon",
        printer_id: "printer-one",
        host_name: "Printer One",
        filename: "plate-one.gcode",
        units: [
          { part_id: 11, unit_index: 0, object_name: "  bracket.stl (1)  " },
          { part_id: 11, unit_index: 1 },
        ],
      });
      expect(created?.units).toEqual([
        { part_id: 11, unit_index: 0, object_name: "bracket.stl (1)" },
        { part_id: 11, unit_index: 1 },
      ]);

      const loaded = getPrinterCheckoffLink(repo, created!.id);
      expect(loaded?.units).toEqual([
        { part_id: 11, unit_index: 0, object_name: "bracket.stl (1)" },
        { part_id: 11, unit_index: 1 },
      ]);
    } finally {
      closeRepo(dir, sqlite);
    }
  });
});
