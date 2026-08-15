import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

export interface VersionInfo {
  version: string;
  commit: string;
  branch: string;
  tag: string;
  buildDate: string;
  nodeVersion: string;
}

let cachedVersionInfo: VersionInfo | null = null;

/**
 * Get version information from package.json and git.
 * Results are cached to avoid repeated shell executions.
 */
export function getVersionInfo(): VersionInfo {
  if (cachedVersionInfo) {
    return cachedVersionInfo;
  }

  try {
    // Read version from package.json
    const packageJsonPath = join(process.cwd(), "..", "..", "package.json");
    const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf-8")) as { version: string };
    const version = packageJson.version;

    // Get git information
    let commit = "unknown";
    let branch = "unknown";
    let tag = "unknown";

    try {
      commit = execSync("git rev-parse --short HEAD", { encoding: "utf-8" }).trim();
    } catch {
      // Git not available
    }

    try {
      branch = execSync("git rev-parse --abbrev-ref HEAD", { encoding: "utf-8" }).trim();
    } catch {
      // Git not available
    }

    try {
      tag = execSync("git describe --tags --abbrev=0", { encoding: "utf-8" }).trim();
    } catch {
      // No tags yet
    }

    cachedVersionInfo = {
      version,
      commit,
      branch,
      tag,
      buildDate: new Date().toISOString(),
      nodeVersion: process.version,
    };

    return cachedVersionInfo;
  } catch (error) {
    // Fallback if anything goes wrong
    return {
      version: "unknown",
      commit: "unknown",
      branch: "unknown",
      tag: "unknown",
      buildDate: new Date().toISOString(),
      nodeVersion: process.version,
    };
  }
}

/**
 * Get a semantic version string for the running build.
 * Format: v{version}+{commit} (if on a tag) or v{version}-{branch}.{commit}
 */
export function getBuildSemver(): string {
  const info = getVersionInfo();
  const { version, commit, tag } = info;

  if (tag === `v${version}`) {
    // On a release tag
    return `v${version}+${commit}`;
  }

  // Development build
  return `v${version}-dev.${commit}`;
}
