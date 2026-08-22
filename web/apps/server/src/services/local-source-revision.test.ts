import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { getDb, SqliteDatabase } from "../db/client.js";
import { AppRepository } from "../db/repository.js";
import { SOURCE_SNAPSHOT_MANIFEST_FILE } from "./local-source-snapshot.js";
import { publishLocalSourceWorkingTree } from "./local-source-revision.js";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "pp-local-revision-"));
  roots.push(dir);
  const sqlite = new SqliteDatabase(dir);
  sqlite.connect();
  const repo = new AppRepository(getDb(sqlite), undefined, sqlite.reposDir);
  const source = repo.createSource({ name: "Local files", source_kind: "local" });
  const workingTree = join(dir, "incoming");
  mkdirSync(workingTree, { recursive: true });
  writeFileSync(join(workingTree, "cube.stl"), "solid cube\nendsolid cube\n");
  return { dir, sqlite, repo, source, workingTree };
}

describe("publishLocalSourceWorkingTree", () => {
  it("records and activates a tracked snapshot from a local working tree", async () => {
    const { sqlite, repo, source, workingTree, dir } = fixture();
    const activated = await publishLocalSourceWorkingTree({
      repo,
      reposDir: sqlite.reposDir,
      sourceId: source.id,
      workingTree,
    });
    expect(activated.current_source_revision_id).toEqual(expect.any(Number));
    const revision = repo.getSourceRevision(activated.current_source_revision_id!);
    expect(revision?.completeness).toBe("complete");
    expect(revision?.snapshot_locator).toBe(
      `${source.id}/revisions/${revision?.upstream_revision_key}`,
    );
    const snapshotStl = join(dir, "repos", revision!.snapshot_locator, "cube.stl");
    expect(existsSync(snapshotStl)).toBe(true);
    expect(readFileSync(snapshotStl, "utf8")).toBe("solid cube\nendsolid cube\n");
    expect(existsSync(join(dir, "repos", revision!.snapshot_locator, SOURCE_SNAPSHOT_MANIFEST_FILE))).toBe(
      true,
    );
    expect(activated.local_path).toBe(join(dir, "repos", revision!.snapshot_locator));

    const again = await publishLocalSourceWorkingTree({
      repo,
      reposDir: sqlite.reposDir,
      sourceId: source.id,
      workingTree,
    });
    expect(again.current_source_revision_id).toBe(activated.current_source_revision_id);

    sqlite.close();
  });

  it("publishes a new revision when the working tree changes", async () => {
    const { sqlite, repo, source, workingTree } = fixture();
    const first = await publishLocalSourceWorkingTree({
      repo,
      reposDir: sqlite.reposDir,
      sourceId: source.id,
      workingTree,
    });
    writeFileSync(join(workingTree, "cube.stl"), "solid cube v2\nendsolid cube\n");
    const second = await publishLocalSourceWorkingTree({
      repo,
      reposDir: sqlite.reposDir,
      sourceId: source.id,
      workingTree,
    });
    expect(second.current_source_revision_id).not.toBe(first.current_source_revision_id);
    sqlite.close();
  });
});
