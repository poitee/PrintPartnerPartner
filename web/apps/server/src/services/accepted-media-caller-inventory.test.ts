import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

const sourceRoot = fileURLToPath(new URL("../", import.meta.url));

function productionTypeScriptFiles(root: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...productionTypeScriptFiles(path));
    } else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) {
      files.push(path);
    }
  }
  return files;
}

function productionCallers(symbol: string, owner: string): string[] {
  const pattern = new RegExp(`\\b${symbol}\\b`);
  return productionTypeScriptFiles(sourceRoot)
    .map((path) => ({
      path,
      relativePath: relative(sourceRoot, path).split(sep).join("/"),
    }))
    .filter((file) => file.relativePath !== owner && pattern.test(readFileSync(file.path, "utf8")))
    .map((file) => file.relativePath)
    .sort();
}

describe("known accepted media production caller inventory", () => {
  it("pins callers of known accepted and working media gateways", () => {
    expect({
      readAcceptedPlanOperationalSnapshot: productionCallers(
        "readAcceptedPlanOperationalSnapshot",
        "db/repository.ts",
      ),
      getAcceptedProfileStlRoots: productionCallers(
        "getAcceptedProfileStlRoots",
        "db/repository.ts",
      ),
      resolvePartStl: productionCallers("resolvePartStl", "services/part-paths.ts"),
      globalThumbnailPath: productionCallers("globalThumbnailPath", "lib/thumbnails.ts"),
      globalPreviewPath: productionCallers("globalPreviewPath", "lib/thumbnails.ts"),
      thumbnailCacheDigest: productionCallers("thumbnailCacheDigest", "lib/thumbnails.ts"),
      previewCacheDigest: productionCallers("previewCacheDigest", "lib/thumbnails.ts"),
      openStlThumbStream: productionCallers("openStlThumbStream", "lib/secure-path.ts"),
      clearPlanThumbnailCache: productionCallers(
        "clearPlanThumbnailCache",
        "services/plan-thumbnails.ts",
      ),
      clearPartThumbnailCacheAtHexes: productionCallers(
        "clearPartThumbnailCacheAtHexes",
        "services/plan-thumbnails.ts",
      ),
      buildPlanReview: productionCallers("buildPlanReview", "services/plan-review.ts"),
      observeAcceptedArtifact: productionCallers(
        "observeAcceptedArtifact",
        "services/accepted-artifacts.ts",
      ),
      openVerifiedAcceptedArtifact: productionCallers(
        "openVerifiedAcceptedArtifact",
        "services/accepted-artifacts.ts",
      ),
      acceptedMediaBasis: productionCallers("acceptedMediaBasis", "lib/accepted-media-cache.ts"),
      readAcceptedMediaPng: productionCallers(
        "readAcceptedMediaPng",
        "lib/accepted-media-cache.ts",
      ),
      writeAcceptedMediaPng: productionCallers(
        "writeAcceptedMediaPng",
        "lib/accepted-media-cache.ts",
      ),
    }).toEqual({
      readAcceptedPlanOperationalSnapshot: ["routes/parts.ts", "routes/plans.ts"],
      getAcceptedProfileStlRoots: ["services/part-paths.ts"],
      resolvePartStl: [
        "db/repository.ts",
        "routes/parts.ts",
        "routes/plans.ts",
        "services/plan-review.ts",
        "services/plan-thumbnails.ts",
      ],
      globalThumbnailPath: [
        "lib/secure-path.ts",
        "routes/parts.ts",
        "services/export-html.ts",
        "services/plan-review.ts",
        "services/plan-thumbnails.ts",
      ],
      globalPreviewPath: [
        "lib/secure-path.ts",
        "routes/parts.ts",
        "services/plan-thumbnails.ts",
      ],
      thumbnailCacheDigest: ["routes/parts.ts"],
      previewCacheDigest: [],
      openStlThumbStream: ["routes/sources.ts"],
      clearPlanThumbnailCache: ["routes/parts.ts", "routes/plans.ts"],
      clearPartThumbnailCacheAtHexes: ["routes/plans.ts"],
      buildPlanReview: ["assistant/tools.ts", "routes/plans.ts"],
      observeAcceptedArtifact: [],
      openVerifiedAcceptedArtifact: [],
      acceptedMediaBasis: [],
      readAcceptedMediaPng: [],
      writeAcceptedMediaPng: [],
    });
  });
});
