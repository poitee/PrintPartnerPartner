import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { getDb, SqliteDatabase } from "../db/client.js";
import { AppRepository } from "../db/repository.js";
import { createIntegrationPort } from "./store.js";
import { spoolmanAdapter } from "./adapters/spoolman.js";

describe("integration store", () => {
  it("preserves secrets when patch contains redacted placeholders", () => {
    const dir = mkdtempSync(join(tmpdir(), "pp-int-store-"));
    const sqlite = new SqliteDatabase(dir);
    sqlite.connect();
    const repo = new AppRepository(getDb(sqlite), undefined, sqlite.reposDir);
    const port = createIntegrationPort({
      repo,
      getAdapter: (type) => (type === "spoolman" ? spoolmanAdapter : undefined),
    });

    const created = port.create({
      type: "spoolman",
      name: "Workshop",
      config: { base_url: "http://192.168.1.50:7912", api_key: "real-secret" },
    });

    const listed = port.list().find((x) => x.id === created.id)!;
    expect(listed.config.api_key).toBe("****");

    const updated = port.update(created.id, {
      config: { ...listed.config, enabled: false },
    });
    expect(updated?.config.enabled).toBe(false);

    const raw = repo.getSetting("integrations");
    expect(raw).toContain("real-secret");
    expect(raw).not.toContain('"api_key":"****"');

    sqlite.close();
    rmSync(dir, { recursive: true, force: true });
  });
});
