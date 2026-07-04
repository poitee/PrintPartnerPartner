import { unlinkSync } from "node:fs";
import type { AppRepository } from "../db/repository.js";
import {
  cachedPngIfExists,
  globalPreviewPath,
  globalThumbnailPath,
} from "../lib/thumbnails.js";
import { resolvePartFilamentHex } from "./filament-catalog.js";
import { resolvePartStl } from "./part-paths.js";
import { normalizePartRole } from "./role-filament.js";

/**
 * Remove cached thumbnail/preview PNGs for parts in a plan so the next request
 * re-renders from the current filament colors.
 */
export function clearPlanThumbnailCache(
  repo: AppRepository,
  thumbsDir: string,
  profileId: number,
  opts?: { role?: string },
): number {
  const targetRole = opts?.role != null ? normalizePartRole(opts.role) : null;
  let cleared = 0;
  for (const part of repo.getProfilePartRows(profileId)) {
    if (targetRole != null && normalizePartRole(part.role) !== targetRole) continue;
    const stl = resolvePartStl(repo, part);
    if (!stl) continue;
    const hex = resolvePartFilamentHex(part);
    const role = part.role || "primary";
    const paths = [
      globalThumbnailPath(thumbsDir, stl, role, hex),
      globalPreviewPath(thumbsDir, stl, role, hex),
    ];
    for (const path of paths) {
      if (!cachedPngIfExists(path)) continue;
      try {
        unlinkSync(path);
        cleared += 1;
      } catch {
        /* ignore */
      }
    }
  }
  return cleared;
}
