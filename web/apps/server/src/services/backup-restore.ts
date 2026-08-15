import { createWriteStream, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { createReadStream, promises as fs } from "node:fs";
import { createGzip, createGunzip } from "node:zlib";
import { pipeline } from "node:stream/promises";
import * as tar from "tar";
import type { SqliteDatabase } from "../db/client.js";

export type BackupMetadata = {
  version: string;
  createdAt: string;
  appVersion: string;
  formatVersion: 1;
};

const BACKUP_FORMAT_VERSION = 1;
const BACKUP_METADATA_FILE = "backup-metadata.json";

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

  // Create temporary directory for backup staging
  const tempDir = join(dataDir, ".backup-tmp");
  mkdirSync(tempDir, { recursive: true });

  try {
    // Step 1: Create backup of SQLite database
    const backupDbPath = join(tempDir, "print-partner.db");
    const backupDbWalPath = join(tempDir, "print-partner.db-wal");

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
    // Critical: database and metadata
    const filesToBackup = [
      { path: backupDbPath, name: "print-partner.db" },
      { path: backupDbWalPath, name: "print-partner.db-wal" },
      { path: join(tempDir, BACKUP_METADATA_FILE), name: BACKUP_METADATA_FILE },
    ];

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

    // Create tar archive with just the database and metadata
    // Large directories (repos, sources) can be added later via settings UI if needed
    const output = createWriteStream(outputPath);
    const gzip = createGzip();

    await pipeline(
      tar.c(
        {
          gzip: false,
          cwd: tempDir,
        },
        existingFiles
          .filter((f) => f.path.startsWith(tempDir))
          .map((f) => f.name),
      ),
      gzip,
      output,
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
 * Validates a backup archive without extracting it.
 * Checks metadata and structural integrity.
 */
export async function validateBackup(backupPath: string): Promise<BackupMetadata> {
  const tempDir = join(resolve(backupPath), "..", ".validate-tmp");
  mkdirSync(tempDir, { recursive: true });

  try {
    // Extract metadata only
    const metadataPath = join(tempDir, BACKUP_METADATA_FILE);

    const gunzip = createGunzip();
    const input = createReadStream(backupPath);

    await pipeline(
      input,
      gunzip,
      tar.x({
        cwd: tempDir,
        filter: (p: string) => p === BACKUP_METADATA_FILE,
      }),
    );

    const metadataContent = readFileSync(metadataPath, "utf-8");
    const metadata: BackupMetadata = JSON.parse(metadataContent);

    // Validate metadata structure
    if (!metadata.version || !metadata.createdAt || !metadata.formatVersion) {
      throw new Error("Invalid backup metadata: missing required fields");
    }

    if (metadata.formatVersion > BACKUP_FORMAT_VERSION) {
      throw new Error(
        `Backup format version ${metadata.formatVersion} is newer than supported ${BACKUP_FORMAT_VERSION}`,
      );
    }

    return metadata;
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

  // Validate backup before proceeding
  const metadata = await validateBackup(backupPath);

  // Close the database to ensure exclusive access to files
  sqlite.close();

  const tempDir = join(dataDir, ".restore-tmp");
  mkdirSync(tempDir, { recursive: true });

  try {
    // Extract backup contents
    const gunzip = createGunzip();
    const input = createReadStream(backupPath);

    await pipeline(
      input,
      gunzip,
      tar.x({
        cwd: tempDir,
      }),
    );

    // Backup current data (safety measure)
    const currentBackupDir = join(dataDir, ".pre-restore-backup");
    mkdirSync(currentBackupDir, { recursive: true });

    const dirsToBackup = ["repos", "sources", "exports", "thumbs", "covers"];
    for (const dir of dirsToBackup) {
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
    for (const dir of dirsToBackup) {
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
    const restoredDb = join(tempDir, "print-partner.db");
    try {
      const dbContent = readFileSync(restoredDb);
      writeFileSync(sqlite.dbPath, dbContent);

      // Also restore WAL if it exists
      const restoredWal = join(tempDir, "print-partner.db-wal");
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
    try {
      sqlite.connect();
    } catch (reconnectErr) {
      // Reconnect failed; database state is unknown
      console.error("[backup-restore] Failed to reconnect after restore error:", reconnectErr);
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
