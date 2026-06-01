import { describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { eq } from "drizzle-orm";
import { getDb, SqliteDatabase } from "./db/client.js";
import { AppRepository } from "./db/repository.js";
import * as defaultSchema from "./db/schema.js";
import { normalizePartRole } from "./services/role-filament.js";

describe("normalizePartRole", () => {
  it("maps empty and whitespace roles to primary", () => {
    expect(normalizePartRole("")).toBe("primary");
    expect(normalizePartRole("   ")).toBe("primary");
    expect(normalizePartRole(null)).toBe("primary");
    expect(normalizePartRole(undefined)).toBe("primary");
  });

  it("preserves explicit role ids", () => {
    expect(normalizePartRole("accent")).toBe("accent");
    expect(normalizePartRole("  clear  ")).toBe("clear");
  });
});

describe("bulkSetRoleFilament", () => {
  it("updates included parts when stored role is empty but grouped as primary", () => {
    const dir = mkdtempSync(join(tmpdir(), "pp-role-fil-"));
    const sqlite = new SqliteDatabase(dir);
    sqlite.connect();
    const db = getDb(sqlite);
    const repo = new AppRepository(db, undefined, sqlite.reposDir);

    const source = repo.createSource({ name: "RoleRepo", url: "https://github.com/a/b" });
    const repoPath = join(dir, "repos", String(source.id));
    mkdirSync(join(repoPath, "parts"), { recursive: true });
    writeFileSync(join(repoPath, "parts", "widget.stl"), "solid widget");
    repo.updateSource(source.id, { local_path: repoPath });
    repo.updateImportRules(source.id, ["parts/"]);

    const plan = repo.createProfile("RolePlan", source.id);
    repo.recomputeProfile(plan.id);
    const partId = repo.listParts(plan.id).parts[0]!.id;
    db.update(defaultSchema.parts)
      .set({ role: "" })
      .where(eq(defaultSchema.parts.id, partId))
      .run();

    const updated = repo.bulkSetRoleFilament(plan.id, "primary", "pla-black", null);
    expect(updated).toBe(1);

    const roles = repo.getRoleFilaments(plan.id);
    expect(roles).toHaveLength(1);
    expect(roles[0]!.filament_color_id).toBe("pla-black");

    sqlite.close();
    rmSync(dir, { recursive: true, force: true });
  });
});
