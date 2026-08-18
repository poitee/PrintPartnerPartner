import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { getDb, SqliteDatabase } from "../db/client.js";
import { AppRepository } from "../db/repository.js";
import {
  createApiKey,
  listApiKeys,
  validateApiKey,
} from "./api-key-manager.js";

function withRepository(run: (repo: AppRepository) => void): void {
  const dir = mkdtempSync(join(tmpdir(), "pp-api-key-manager-"));
  const sqlite = new SqliteDatabase(dir);
  sqlite.connect();

  try {
    run(new AppRepository(getDb(sqlite), "default", sqlite.reposDir));
  } finally {
    sqlite.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("API key manager security", () => {
  it("stores settings API keys as non-recoverable digests and only returns plaintext once", () => {
    withRepository((repo) => {
      const created = createApiKey(repo);
      const persisted = repo.getSetting("api_keys_v1")!;

      expect(created.key).toMatch(/^ppk_[a-f0-9]{64}$/);
      expect(created).not.toHaveProperty("keyHash");
      expect(persisted).not.toContain(created.key);
      expect(JSON.parse(persisted)[0].keyHash).toMatch(/^[a-f0-9]{64}$/);
      expect(listApiKeys(repo)[0]).not.toHaveProperty("keyHash");
      expect(listApiKeys(repo)[0]).not.toHaveProperty("key");
    });
  });

  it("rejects an expired settings API key", () => {
    withRepository((repo) => {
      const created = createApiKey(repo);
      const stored = JSON.parse(repo.getSetting("api_keys_v1")!) as Array<{
        expiresAt: string | null;
      }>;
      stored[0]!.expiresAt = new Date(0).toISOString();
      repo.setSetting("api_keys_v1", JSON.stringify(stored));

      expect(validateApiKey(repo, created.key)).toBeNull();
    });
  });
});
