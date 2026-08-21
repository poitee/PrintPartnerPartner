import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const sourceRoot = fileURLToPath(new URL("../", import.meta.url));

function productionTypeScriptFiles(root: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) files.push(...productionTypeScriptFiles(path));
    else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) files.push(path);
  }
  return files;
}

function knownProductionCallers(
  symbol: string,
  owner: string,
): Array<{ readonly file: string; readonly count: number }> {
  const pattern = new RegExp(`\\b${symbol}\\b`);
  return productionTypeScriptFiles(sourceRoot)
    .map((path) => ({ path, relativePath: relative(sourceRoot, path).split(sep).join("/") }))
    .filter((file) => file.relativePath !== owner && pattern.test(readFileSync(file.path, "utf8")))
    .map((file) => ({
      file: file.relativePath,
      count: readFileSync(file.path, "utf8").match(new RegExp(`\\b${symbol}\\b`, "g"))?.length ?? 0,
    }))
    .sort((left, right) => left.file.localeCompare(right.file));
}

function sourceBetween(source: string, start: string, end: string): string {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  if (startIndex < 0 || endIndex < 0) throw new Error(`Missing source boundary: ${start} / ${end}`);
  return source.slice(startIndex, endIndex);
}

describe("Profile summary caller inventory", () => {
  it("pins summary, header, and identity API consumers", () => {
    expect(knownProductionCallers("getProfile", "db/repository.ts")).toEqual([
      { file: "routes/plans.ts", count: 6 },
    ]);
    expect(knownProductionCallers("listProfiles", "db/repository.ts")).toEqual([
      { file: "routes/plans.ts", count: 1 },
    ]);
    expect(knownProductionCallers("listAcceptedProfileSummaries", "db/repository.ts")).toEqual([
      { file: "assistant/tools.ts", count: 1 },
      { file: "routes/discord-digest.ts", count: 1 },
      { file: "routes/metrics.ts", count: 1 },
    ]);
    expect(knownProductionCallers("getProfileHeader", "db/repository.ts")).toEqual([
      { file: "assistant/assistant-context.ts", count: 1 },
      { file: "assistant/tools.ts", count: 1 },
    ]);
    expect(knownProductionCallers("listProfileHeaders", "db/repository.ts")).toEqual([
      { file: "assistant/example-builds.ts", count: 1 },
      { file: "assistant/tools.ts", count: 1 },
      { file: "routes/printer-checkoff.ts", count: 1 },
      { file: "services/knowledge-bundle.ts", count: 1 },
    ]);
    const digestCapture = readFileSync(
      join(sourceRoot, "../capture-digest-fixtures.ts"),
      "utf8",
    );
    expect(
      digestCapture.match(/\binvokeAssistantTool\(\s*"get_print_stats"/g) ?? [],
    ).toHaveLength(1);
  });

  it("keeps repository summary reads in summary-returning mutation paths", () => {
    const repository = readFileSync(join(sourceRoot, "db/repository.ts"), "utf8");
    expect(repository.match(/\bthis\.getProfile\(/g) ?? []).toHaveLength(4);
    const summaryMethods = {
      create: sourceBetween(repository, "  createProfile(", "  deleteProfile("),
      rename: sourceBetween(repository, "  renameProfile(", "  updateProfileSpecialRequest("),
      specialRequest: sourceBetween(
        repository,
        "  updateProfileSpecialRequest(",
        "  unarchiveProfile(",
      ),
      touch: sourceBetween(repository, "  touchProfileLastUsed(", "  duplicateProfile("),
    };
    expect(
      Object.fromEntries(
        Object.entries(summaryMethods).map(([name, method]) => [
          name,
          (method.match(/\bthis\.getProfile\(/g) ?? []).length,
        ]),
      ),
    ).toEqual({ create: 1, rename: 1, specialRequest: 1, touch: 1 });
    expect(
      sourceBetween(repository, "  duplicateProfile(", "  removeLayer(").match(
        /\bthis\.getProfileHeader\(/g,
      ) ?? [],
    ).toHaveLength(1);
  });
});
