import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as tar from "tar";
import { afterEach, describe, expect, it } from "vitest";
import type { SqliteDatabase } from "../db/client.js";
import {
  createBackup,
  restoreBackup,
  validateBackup,
} from "./backup-restore.js";

const METADATA = {
  version: "1",
  createdAt: "2026-08-18T00:00:00.000Z",
  appVersion: "3.0.0",
  formatVersion: 1,
};

describe("backup create, validate, and restore", () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
    dirs.length = 0;
  });

  function tempDir(): string {
    const dir = mkdtempSync(join(tmpdir(), "pp-backup-integrity-"));
    dirs.push(dir);
    return dir;
  }

  it("round-trips the database and critical data directories", async () => {
    const dataDir = tempDir();
    const outputPath = join(dataDir, "snapshot.tar.gz");
    const dbPath = join(dataDir, "print-partner.db");
    const backupDb = sqliteFile("backed-up");
    writeFileSync(dbPath, sqliteFile("current-before-backup"));
    mkdirSync(join(dataDir, "sources", "repo"), { recursive: true });
    mkdirSync(join(dataDir, "exports", "kit"), { recursive: true });
    writeFileSync(join(dataDir, "sources", "repo", "part.stl"), "original-stl");
    writeFileSync(join(dataDir, "exports", "kit", "plate.3mf"), "original-3mf");
    const sqlite = fakeSqlite(dataDir, backupDb);

    await createBackup(sqlite.value, dataDir, "3.0.0", outputPath);
    const metadata = await validateBackup(outputPath);
    expect(metadata).toMatchObject({ appVersion: "3.0.0", formatVersion: 1 });

    writeFileSync(dbPath, sqliteFile("mutated-db"));
    writeFileSync(join(dataDir, "sources", "repo", "part.stl"), "mutated-stl");
    writeFileSync(join(dataDir, "exports", "kit", "plate.3mf"), "mutated-3mf");

    await restoreBackup(outputPath, dataDir, sqlite.value);

    expect(readFileSync(dbPath)).toEqual(backupDb);
    expect(readFileSync(join(dataDir, "sources", "repo", "part.stl"), "utf8")).toBe(
      "original-stl",
    );
    expect(readFileSync(join(dataDir, "exports", "kit", "plate.3mf"), "utf8")).toBe(
      "original-3mf",
    );
    expect(sqlite.closeCalls()).toBe(1);
    expect(sqlite.connectCalls()).toBe(1);
  });

  it("rejects corrupt compressed input", async () => {
    const dir = tempDir();
    const archive = join(dir, "corrupt.tar.gz");
    writeFileSync(archive, "not a gzip stream");

    await expect(validateBackup(archive)).rejects.toThrow();
  });

  it("rejects an archive missing its database before closing or mutating SQLite", async () => {
    const dataDir = tempDir();
    const archive = join(dataDir, "missing-db.tar.gz");
    await writeArchive(archive, {
      "backup-metadata.json": JSON.stringify(METADATA),
    });
    const original = sqliteFile("must-remain");
    writeFileSync(join(dataDir, "print-partner.db"), original);
    const sqlite = fakeSqlite(dataDir, sqliteFile("unused"));

    await expect(restoreBackup(archive, dataDir, sqlite.value)).rejects.toThrow(
      /print-partner\.db/,
    );
    expect(sqlite.closeCalls()).toBe(0);
    expect(readFileSync(join(dataDir, "print-partner.db"))).toEqual(original);
  });

  it("rejects a traversal entry before closing SQLite or writing outside dataDir", async () => {
    const dataDir = tempDir();
    const staging = join(dataDir, "staging");
    mkdirSync(staging);
    writeFileSync(join(staging, "backup-metadata.json"), JSON.stringify(METADATA));
    writeFileSync(join(staging, "print-partner.db"), sqliteFile("backup"));
    writeFileSync(join(dataDir, "escape.txt"), "archive payload");
    const archive = join(dataDir, "traversal.tar.gz");
    await tar.c(
      {
        cwd: staging,
        file: archive,
        gzip: true,
        preservePaths: true,
      },
      ["backup-metadata.json", "print-partner.db", "../escape.txt"],
    );
    rmSync(join(dataDir, "escape.txt"));
    const original = sqliteFile("must-remain");
    writeFileSync(join(dataDir, "print-partner.db"), original);
    const sqlite = fakeSqlite(dataDir, sqliteFile("unused"));

    await expect(restoreBackup(archive, dataDir, sqlite.value)).rejects.toThrow(
      /Unsafe backup entry path/,
    );
    expect(sqlite.closeCalls()).toBe(0);
    expect(readFileSync(join(dataDir, "print-partner.db"))).toEqual(original);
    expect(() => readFileSync(join(dataDir, "escape.txt"))).toThrow();
  });

  it("rejects a structurally valid archive with a corrupt SQLite payload", async () => {
    const dir = tempDir();
    const archive = join(dir, "bad-db.tar.gz");
    await writeArchive(archive, {
      "backup-metadata.json": JSON.stringify(METADATA),
      "print-partner.db": "definitely not sqlite",
    });

    await expect(validateBackup(archive)).rejects.toThrow(/SQLite database/);
  });
});

function sqliteFile(marker: string): Buffer {
  return Buffer.concat([
    Buffer.from("SQLite format 3\0", "binary"),
    Buffer.from(marker),
  ]);
}

function fakeSqlite(dataDir: string, backupContent: Buffer) {
  let closes = 0;
  let connects = 0;
  const value = {
    dbPath: join(dataDir, "print-partner.db"),
    ping: () => true,
    backupFileContent: () => backupContent,
    backupWalFileContent: () => null,
    close: () => {
      closes += 1;
    },
    connect: () => {
      connects += 1;
    },
  } as unknown as SqliteDatabase;
  return {
    value,
    closeCalls: () => closes,
    connectCalls: () => connects,
  };
}

async function writeArchive(
  archive: string,
  files: Record<string, string>,
): Promise<void> {
  const staging = mkdtempSync(join(tmpdir(), "pp-backup-archive-"));
  try {
    for (const [name, contents] of Object.entries(files)) {
      writeFileSync(join(staging, name), contents);
    }
    await tar.c({ cwd: staging, file: archive, gzip: true }, Object.keys(files));
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
}
