import type { FastifyInstance } from "fastify";
import { createReadStream, mkdirSync } from "node:fs";
import { join } from "node:path";
import { promises as fs } from "node:fs";
import type { SqliteDatabase } from "../db/client.js";
import { createBackup, restoreBackup, validateBackup } from "../services/backup-restore.js";

type RouteDeps = {
  dataDir: string;
  sqlite: SqliteDatabase | null;
  appVersion: string;
};

export async function registerBackupRoutes(
  app: FastifyInstance,
  deps: RouteDeps,
): Promise<void> {
  /**
   * POST /backups
   * Creates a new backup archive.
   * Returns the backup file path and metadata.
   */
  app.post<{
    Reply: { path: string; name: string; size: number; metadata: object } | { detail: string };
  }>("/backups", async (_request, reply) => {
      try {
        const backupsDir = join(deps.dataDir, "backups");
        mkdirSync(backupsDir, { recursive: true });

        const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
        const backupFileName = `print-partner-backup-${timestamp}.tar.gz`;
        const backupPath = join(backupsDir, backupFileName);

        await createBackup(deps.sqlite, deps.dataDir, deps.appVersion, backupPath);

        const stats = await fs.stat(backupPath);

        return reply.status(201).send({
          path: backupPath,
          name: backupFileName,
          size: stats.size,
          metadata: {
            createdAt: new Date().toISOString(),
            appVersion: deps.appVersion,
          },
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return reply.status(500).send({
          detail: `Backup failed: ${message}`,
        });
      }
    },
  );

  /**
   * GET /backups
   * Lists available backup files.
   */
  app.get<{ Reply: Array<{ name: string; size: number; createdAt: string }> | { detail: string } }>(
    "/backups",
    async (_request, reply) => {
      try {
        const backupsDir = join(deps.dataDir, "backups");

        try {
          const files = await fs.readdir(backupsDir);
          const backups = await Promise.all(
            files
              .filter((f) => f.endsWith(".tar.gz"))
              .map(async (name) => {
                const fullPath = join(backupsDir, name);
                const stats = await fs.stat(fullPath);
                return {
                  name,
                  size: stats.size,
                  createdAt: stats.mtime.toISOString(),
                };
              }),
          );

          // Sort by creation time, newest first
          backups.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

          return reply.send(backups);
        } catch {
          // Backups directory doesn't exist yet
          return reply.send([]);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return reply.status(500).send({
          detail: `Failed to list backups: ${message}`,
        });
      }
    },
  );

  /**
   * GET /backups/:name
   * Downloads a specific backup file.
   */
  app.get("/backups/:name", async (request, reply) => {
    try {
      const { name } = request.params as { name: string };

      // Prevent directory traversal
      if (name.includes("..") || name.includes("/")) {
        return reply.status(400).send({
          detail: "Invalid backup name",
        });
      }

      const backupsDir = join(deps.dataDir, "backups");
      const backupPath = join(backupsDir, name);

      // Verify the file is actually in the backups directory
      const resolvedBackupPath = await fs.realpath(backupPath);
      const resolvedBackupsDir = await fs.realpath(backupsDir);

      if (!resolvedBackupPath.startsWith(resolvedBackupsDir)) {
        return reply.status(403).send({
          detail: "Access denied",
        });
      }

      try {
        const stats = await fs.stat(backupPath);
        if (!stats.isFile()) {
          return reply.status(404).send({
            detail: "Backup file not found",
          });
        }

        return reply
          .header("Content-Type", "application/gzip")
          .header("Content-Disposition", `attachment; filename="${name}"`)
          .header("Content-Length", stats.size)
          .send(createReadStream(backupPath));
      } catch {
        return reply.status(404).send({
          detail: "Backup file not found",
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return reply.status(500).send({
        detail: `Failed to download backup: ${message}`,
      });
    }
  });

  /**
   * POST /backups/validate
   * Validates a backup file without extracting it.
   * Expects the backup file as form data.
   */
  app.post<{ Reply: { valid: boolean; metadata?: object } | { detail: string } }>(
    "/backups/validate",
    {
      schema: {
        consumes: ["multipart/form-data"],
      },
    },
    async (request, reply) => {
      try {
        const data = await request.file();
        if (!data) {
          return reply.status(400).send({
            detail: "No backup file provided",
          });
        }

        const tempDir = join(deps.dataDir, ".validate-tmp");
        mkdirSync(tempDir, { recursive: true });

        try {
          const tempFilePath = join(tempDir, data.filename);
          const buffer = await data.toBuffer();
          await fs.writeFile(tempFilePath, buffer);

          const metadata = await validateBackup(tempFilePath);

          return reply.send({
            valid: true,
            metadata,
          });
        } finally {
          try {
            await fs.rm(tempDir, { recursive: true, force: true });
          } catch {
            // Ignore cleanup errors
          }
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return reply.status(400).send({
          detail: `Backup validation failed: ${message}`,
        });
      }
    },
  );

  /**
   * POST /backups/restore
   * Restores a backup file.
   * Expects the backup file as form data.
   * WARNING: This replaces all current application data.
   */
  app.post<{ Reply: { success: boolean; message: string } | { detail: string } }>(
    "/backups/restore",
    {
      schema: {
        consumes: ["multipart/form-data"],
      },
    },
    async (request, reply) => {
      try {
        const data = await request.file();
        if (!data) {
          return reply.status(400).send({
            detail: "No backup file provided",
          });
        }

        const tempDir = join(deps.dataDir, ".restore-upload-tmp");
        mkdirSync(tempDir, { recursive: true });

        try {
          const tempFilePath = join(tempDir, data.filename);
          const buffer = await data.toBuffer();
          await fs.writeFile(tempFilePath, buffer);

          const metadata = await restoreBackup(tempFilePath, deps.dataDir, deps.sqlite);

          return reply.send({
            success: true,
            message: `Backup restored successfully (${metadata.createdAt}). Application will restart.`,
          });
        } finally {
          try {
            await fs.rm(tempDir, { recursive: true, force: true });
          } catch {
            // Ignore cleanup errors
          }
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return reply.status(500).send({
          detail: `Restore failed: ${message}`,
        });
      }
    },
  );

  /**
   * DELETE /backups/:name
   * Deletes a specific backup file.
   */
  app.delete("/backups/:name", async (request, reply) => {
    try {
      const { name } = request.params as { name: string };

      // Prevent directory traversal
      if (name.includes("..") || name.includes("/")) {
        return reply.status(400).send({
          detail: "Invalid backup name",
        });
      }

      const backupsDir = join(deps.dataDir, "backups");
      const backupPath = join(backupsDir, name);

      // Verify the file is actually in the backups directory
      const resolvedBackupPath = await fs.realpath(backupPath);
      const resolvedBackupsDir = await fs.realpath(backupsDir);

      if (!resolvedBackupPath.startsWith(resolvedBackupsDir)) {
        return reply.status(403).send({
          detail: "Access denied",
        });
      }

      try {
        await fs.unlink(backupPath);
        return reply.send({ success: true });
      } catch {
        return reply.status(404).send({
          detail: "Backup file not found",
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return reply.status(500).send({
        detail: `Failed to delete backup: ${message}`,
      });
    }
  });
}
