import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { promises as fs } from "node:fs";
import * as tar from "tar";
import type { ReadEntry } from "tar";
import type { SqliteDatabase } from "../db/client.js";

export type BackupMetadata = {
  version: string;
  createdAt: string;
  appVersion: string;
  formatVersion: 1;
};

const BACKUP_FORMAT_VERSION = 1;
const BACKUP_METADATA_FILE = "backup-metadata.json";
const BACKUP_DATABASE_FILE = "print-partner.db";
const BACKUP_WAL_FILE = "print-partner.db-wal";
const BACKUP_DIRECTORIES = ["repos", "sources", "exports", "thumbs", "covers"] as const;
const BACKUP_ROOT_FILES = new Set([
  BACKUP_METADATA_FILE,
  BACKUP_DATABASE_FILE,
  BACKUP_WAL_FILE,
]);
const SQLITE_HEADER = Buffer.from("SQLite format 3\0", "binary");

async function copyBackupDirectory(source: string, target: string): Promise<void> {
  const entries = await fs.readdir(source, { withFileTypes: true });
  await fs.mkdir(target, { recursive: true });
  for (const entry of entries) {
    const sourcePath = join(source, entry.name);
    const targetPath = join(target, entry.name);
    if (entry.isDirectory()) {
      await copyBackupDirectory(sourcePath, targetPath);
    } else if (entry.isFile()) {
      await fs.copyFile(sourcePath, targetPath);
    }
  }
}

function normalizedArchivePath(path: string): string {
  return path.replace(/\\/g, "/").replace(/\/+$/, "");
}

function assertSafeArchiveEntry(entry: ReadEntry, seen: Set<string>): void {
  if (entry.meta) return;
  const rawPath = entry.path;
  const path = normalizedArchivePath(rawPath);
  const parts = path.split("/");
  if (
    !path ||
    rawPath.includes("\\") ||
    rawPath.includes("\0") ||
    rawPath.startsWith("/") ||
    /^[A-Za-z]:/.test(rawPath) ||
    parts.some((part) => part === "" || part === "." || part === "..")
  ) {
    throw new Error(`Unsafe backup entry path: ${rawPath}`);
  }
  const allowed =
    BACKUP_ROOT_FILES.has(path) ||
    BACKUP_DIRECTORIES.some((directory) => path === directory || path.startsWith(`${directory}/`));
  if (!allowed) throw new Error(`Unexpected backup entry: ${rawPath}`);
  if (entry.type !== "File" && entry.type !== "OldFile" && entry.type !== "Directory") {
    throw new Error(`Unsupported backup entry type for ${rawPath}: ${entry.type}`);
  }
  if (seen.has(path)) throw new Error(`Duplicate backup entry: ${rawPath}`);
  seen.add(path);
}

async function inspectBackupArchive(backupPath: string): Promise<void> {
  const seen = new Set<string>();
  await tar.t({
    file: backupPath,
    gzip: true,
    strict: true,
    onentry: (entry) => assertSafeArchiveEntry(entry, seen),
  });
  if (!seen.has(BACKUP_METADATA_FILE)) {
    throw new Error(`Backup archive is missing ${BACKUP_METADATA_FILE}`);
  }
  if (!seen.has(BACKUP_DATABASE_FILE)) {
    throw new Error(`Backup archive is missing ${BACKUP_DATABASE_FILE}`);
  }
}

function readValidatedMetadata(tempDir: string): BackupMetadata {
  const metadataContent = readFileSync(join(tempDir, BACKUP_METADATA_FILE), "utf-8");
  const metadata = JSON.parse(metadataContent) as Partial<BackupMetadata> | null;
  if (
    !metadata ||
    typeof metadata !== "object" ||
    typeof metadata.version !== "string" ||
    typeof metadata.createdAt !== "string" ||
    Number.isNaN(Date.parse(metadata.createdAt)) ||
    typeof metadata.appVersion !== "string" ||
    !Number.isInteger(metadata.formatVersion) ||
    (metadata.formatVersion as number) < 1
  ) {
    throw new Error("Invalid backup metadata: missing or invalid required fields");
  }
  if ((metadata.formatVersion as number) > BACKUP_FORMAT_VERSION) {
    throw new Error(
      `Backup format version ${metadata.formatVersion} is newer than supported ${BACKUP_FORMAT_VERSION}`,
    );
  }
  if (metadata.version !== String(metadata.formatVersion)) {
    throw new Error("Invalid backup metadata: version fields do not match");
  }
  const database = readFileSync(join(tempDir, BACKUP_DATABASE_FILE));
  if (
    database.length < SQLITE_HEADER.length ||
    !database.subarray(0, SQLITE_HEADER.length).equals(SQLITE_HEADER)
  ) {
    throw new Error("Backup contains an invalid SQLite database");
  }
  return metadata as BackupMetadata;
}

async function extractValidatedBackup(backupPath: string, tempDir: string): Promise<BackupMetadata> {
  await inspectBackupArchive(backupPath);
  const extractedEntries = new Set<string>();
  await tar.x({
    file: backupPath,
    gzip: true,
    strict: true,
    cwd: tempDir,
    filter: (_path, entry) => {
      assertSafeArchiveEntry(entry as ReadEntry, extractedEntries);
      return true;
    },
  });
  return readValidatedMetadata(tempDir);
}

/**
 * Creates an application-consistent backup of the SQLite database and critical directories.
 * Uses SQLite's backup API to ensure consistency.
 */
export async function createBackup(
  sqlite: SqliteDatabase | null,
  dataDir: string,
  appVersion: string,
  outputPath: string,
): Promise<void> {
  if (!sqlite) {
    throw new Error("SQLite database not available; backups require self-host mode");
  }

  // Ensure database is connected and healthy
  if (!sqlite.ping()) {
    throw new Error("SQLite database connection failed; cannot create backup");
  }

  const metadata: BackupMetadata = {
    version: String(BACKUP_FORMAT_VERSION),
    createdAt: new Date().toISOString(),
    appVersion,
    formatVersion: BACKUP_FORMAT_VERSION,
  };

  mkdirSync(dataDir, { recursive: true });
  const tempDir = mkdtempSync(join(dataDir, ".backup-tmp-"));

  try {
    // Step 1: Create backup of SQLite database
    const backupDbPath = join(tempDir, BACKUP_DATABASE_FILE);
    const backupDbWalPath = join(tempDir, BACKUP_WAL_FILE);

    // Use backup methods to get consistent snapshots
    const mainDbContent = sqlite.backupFileContent();
    writeFileSync(backupDbPath, mainDbContent);

    const walContent = sqlite.backupWalFileContent();
    if (walContent) {
      writeFileSync(backupDbWalPath, walContent);
    }

    // Step 2: Write metadata
    writeFileSync(
      join(tempDir, BACKUP_METADATA_FILE),
      JSON.stringify(metadata, null, 2),
    );

    // Step 3: Build list of files to backup
    const filesToBackup = [
      { path: backupDbPath, name: BACKUP_DATABASE_FILE },
      { path: backupDbWalPath, name: BACKUP_WAL_FILE },
      { path: join(tempDir, BACKUP_METADATA_FILE), name: BACKUP_METADATA_FILE },
    ];
    for (const directory of BACKUP_DIRECTORIES) {
      const source = join(dataDir, directory);
      try {
        const stats = await fs.lstat(source);
        if (!stats.isDirectory()) continue;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
        throw error;
      }
      await copyBackupDirectory(source, join(tempDir, directory));
      filesToBackup.push({ path: join(tempDir, directory), name: directory });
    }

    // Check what files actually exist
    const existingFiles: Array<{ path: string; name: string }> = [];
    for (const file of filesToBackup) {
      try {
        await fs.stat(file.path);
        existingFiles.push(file);
      } catch {
        // File doesn't exist; skip it
      }
    }

    if (existingFiles.length === 0) {
      throw new Error("No data found to backup");
    }

    await tar.c(
      {
        file: outputPath,
        gzip: true,
        cwd: tempDir,
        strict: true,
      },
      existingFiles.map((file) => file.name),
    );
  } finally {
    // Clean up temporary directory
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  }
}

/**
 * Validates archive entries, metadata, and SQLite integrity in an isolated
 * temporary directory without mutating live application data.
 */
export async function validateBackup(backupPath: string): Promise<BackupMetadata> {
  const absoluteBackupPath = resolve(backupPath);
  const tempDir = mkdtempSync(join(dirname(absoluteBackupPath), ".validate-tmp-"));

  try {
    return await extractValidatedBackup(absoluteBackupPath, tempDir);
  } finally {
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  }
}

/**
 * Restores a backup archive, replacing current data.
 * Should only be called when the application is stopped or in maintenance mode.
 */
export async function restoreBackup(
  backupPath: string,
  dataDir: string,
  sqlite: SqliteDatabase | null,
): Promise<BackupMetadata> {
  if (!sqlite) {
    throw new Error("SQLite database not available; restore requires self-host mode");
  }

  mkdirSync(dataDir, { recursive: true });
  const tempDir = mkdtempSync(join(dataDir, ".restore-tmp-"));
  let databaseClosed = false;

  try {
    // Parse, validate, and safely extract every entry before mutating live data.
    const metadata = await extractValidatedBackup(resolve(backupPath), tempDir);

    // Close the database only after the complete archive has passed validation.
    sqlite.close();
    databaseClosed = true;

    // Backup current data (safety measure)
    const currentBackupDir = join(dataDir, ".pre-restore-backup");
    mkdirSync(currentBackupDir, { recursive: true });

    for (const dir of BACKUP_DIRECTORIES) {
      const currentPath = join(dataDir, dir);
      const backupPath = join(currentBackupDir, dir);
      try {
        await fs.cp(currentPath, backupPath, { recursive: true, force: true });
      } catch {
        // Directory might not exist yet; that's OK
      }
    }

    // Backup current database
    try {
      const currentDb = readFileSync(sqlite.dbPath);
      writeFileSync(join(currentBackupDir, "print-partner.db.bak"), currentDb);
    } catch {
      // Database might not exist yet
    }

    // Restore files
    for (const dir of BACKUP_DIRECTORIES) {
      const restoredPath = join(tempDir, dir);
      const targetPath = join(dataDir, dir);

      try {
        const stats = await fs.stat(restoredPath);
        if (stats.isDirectory()) {
          await fs.rm(targetPath, { recursive: true, force: true });
          await fs.cp(restoredPath, targetPath, { recursive: true });
        }
      } catch {
        // Directory doesn't exist in backup; skip it
      }
    }

    // Restore database
    const restoredDb = join(tempDir, BACKUP_DATABASE_FILE);
    try {
      const dbContent = readFileSync(restoredDb);
      writeFileSync(sqlite.dbPath, dbContent);

      // Never retain journal state from the database being replaced.
      await fs.rm(sqlite.dbPath + "-wal", { force: true });
      await fs.rm(sqlite.dbPath + "-shm", { force: true });

      // Restore the matching WAL when the backup includes one.
      const restoredWal = join(tempDir, BACKUP_WAL_FILE);
      try {
        const walContent = readFileSync(restoredWal);
        writeFileSync(sqlite.dbPath + "-wal", walContent);
      } catch {
        // WAL file doesn't exist; that's OK
      }
    } catch (e) {
      // eslint-disable-next-line preserve-caught-error
      throw new Error(`Failed to restore database: ${e instanceof Error ? e.message : String(e)}`);
    }

    // Reconnect to restored database
    sqlite.connect();

    return metadata;
  } catch (e) {
    const capturedError = e instanceof Error ? e : new Error(String(e));
    // Try to reconnect to the database even if restore failed
    if (databaseClosed) {
      try {
        sqlite.connect();
      } catch (reconnectErr) {
        // Reconnect failed; database state is unknown
        console.error("[backup-restore] Failed to reconnect after restore error:", reconnectErr);
      }
    }
    // eslint-disable-next-line preserve-caught-error
    throw new Error(`Restore failed: ${capturedError.message}`, { cause: capturedError });
  } finally {
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  }
}
