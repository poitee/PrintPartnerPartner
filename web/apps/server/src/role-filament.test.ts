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
    expect(normalizePartRole("Accent")).toBe("accent");
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
    const primary = roles.find((r) => r.role === "primary");
    expect(primary?.filament_color_id).toBe("pla-black");

    sqlite.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("stores spool assignment on included parts for a role", () => {
    const dir = mkdtempSync(join(tmpdir(), "pp-role-spool-"));
    const sqlite = new SqliteDatabase(dir);
    sqlite.connect();
    const db = getDb(sqlite);
    const repo = new AppRepository(db, undefined, sqlite.reposDir);

    const source = repo.createSource({ name: "SpoolRepo", url: "https://github.com/a/b" });
    const repoPath = join(dir, "repos", String(source.id));
    mkdirSync(join(repoPath, "parts"), { recursive: true });
    writeFileSync(join(repoPath, "parts", "widget.stl"), "solid widget");
    repo.updateSource(source.id, { local_path: repoPath });
    repo.updateImportRules(source.id, ["parts/"]);

    const plan = repo.createProfile("SpoolPlan", source.id);
    repo.recomputeProfile(plan.id);
    const filamentId = "spoolman:test-int:filament:7";
    const spoolRef = "spoolman:test-int:spool:3";

    repo.bulkSetRoleFilament(plan.id, "primary", filamentId, null);
    repo.bulkSetRoleFilament(plan.id, "primary", filamentId, null, spoolRef);

    const part = repo.listParts(plan.id).parts[0]!;
    expect(part.filament_color_id).toBe(filamentId);
    expect(part.spoolman_spool_id).toBe(spoolRef);

    const roles = repo.getRoleFilaments(plan.id);
    expect(roles[0]!.spoolman_spool_id).toBe(spoolRef);

    sqlite.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("lists canonical roles and saves defaults before matching parts exist", () => {
    const dir = mkdtempSync(join(tmpdir(), "pp-role-defaults-"));
    const sqlite = new SqliteDatabase(dir);
    sqlite.connect();
    const repo = new AppRepository(getDb(sqlite), undefined, sqlite.reposDir);

    const plan = repo.createProfile("DefaultsPlan");
    const rolesBefore = repo.getRoleFilaments(plan.id);
    expect(rolesBefore.map((r) => r.role)).toEqual(["primary", "accent", "clear", "opaque"]);
    expect(rolesBefore.every((r) => r.part_count === 0)).toBe(true);

    const updated = repo.bulkSetRoleFilament(plan.id, "accent", null, "#ff6600");
    expect(updated).toBe(0);

    const rolesAfter = repo.getRoleFilaments(plan.id);
    const accent = rolesAfter.find((r) => r.role === "accent");
    expect(accent?.filament_custom_hex).toBe("#ff6600");
    expect(accent?.filament_hex).toBe("#ff6600");

    const source = repo.createSource({ name: "AccentRepo", url: "https://github.com/a/b" });
    const repoPath = join(dir, "repos", String(source.id));
    mkdirSync(join(repoPath, "parts"), { recursive: true });
    writeFileSync(join(repoPath, "parts", "[a]_bracket.stl"), "solid accent");
    repo.updateSource(source.id, { local_path: repoPath });
    repo.updateImportRules(source.id, ["parts/"]);
    repo.setBaseLayer(plan.id, source.id);
    repo.recomputeProfile(plan.id);

    const accentPart = repo.listParts(plan.id).parts.find((p) => p.role === "accent");
    expect(accentPart?.filament_custom_hex).toBe("#ff6600");

    sqlite.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("matches bulk updates when stored role casing differs", () => {
    const dir = mkdtempSync(join(tmpdir(), "pp-role-case-"));
    const sqlite = new SqliteDatabase(dir);
    sqlite.connect();
    const db = getDb(sqlite);
    const repo = new AppRepository(db, undefined, sqlite.reposDir);

    const source = repo.createSource({ name: "CaseRepo", url: "https://github.com/a/b" });
    const repoPath = join(dir, "repos", String(source.id));
    mkdirSync(join(repoPath, "parts"), { recursive: true });
    writeFileSync(join(repoPath, "parts", "bracket.stl"), "solid");
    repo.updateSource(source.id, { local_path: repoPath });
    repo.updateImportRules(source.id, ["parts/"]);
    const plan = repo.createProfile("CasePlan", source.id);
    repo.recomputeProfile(plan.id);
    const partId = repo.listParts(plan.id).parts[0]!.id;
    db.update(defaultSchema.parts)
      .set({ role: "Accent" })
      .where(eq(defaultSchema.parts.id, partId))
      .run();

    const updated = repo.bulkSetRoleFilament(plan.id, "accent", "pla-black", null);
    expect(updated).toBe(1);
    expect(repo.listParts(plan.id).parts[0]?.filament_color_id).toBe("pla-black");

    sqlite.close();
    rmSync(dir, { recursive: true, force: true });
  });
});
