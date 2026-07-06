import type { QueryClient } from "@tanstack/react-query";
import type { JobSnapshot } from "../api/engine";
import { queryKeys } from "./keys";
import { invalidatePlanReview } from "./planReview";
import { invalidateProfiles } from "./profiles";
import { invalidateSources } from "./sources";

const SYNC_KINDS = new Set(["sync", "sync-all", "check-source-updates", "import-scan"]);
const RECOMPUTE_KINDS = new Set(["recompute", "apply-manifest"]);
const SOURCE_MUTATION_KINDS = new Set([
  "import-repos-txt",
  "import-kit-bundle",
  ...SYNC_KINDS,
]);

/** Invalidate TanStack Query caches after a background job completes. */
export function invalidateAfterJob(
  qc: QueryClient,
  kind: string,
  snapshot: JobSnapshot,
  profileId?: number | null,
) {
  if (snapshot.status !== "done") return;

  if (SOURCE_MUTATION_KINDS.has(kind)) {
    void invalidateSources(qc);
    void invalidateProfiles(qc);
  }

  if (RECOMPUTE_KINDS.has(kind) && profileId != null) {
    void invalidatePlanReview(qc, profileId);
    void invalidateProfiles(qc);
    void qc.invalidateQueries({ queryKey: queryKeys.planLayers(profileId) });
    void qc.invalidateQueries({ queryKey: queryKeys.roleFilaments(profileId) });
  }

  if (kind === "stl-export" || kind === "export-kit-bundle" || kind === "export-checklist-html") {
    // Exports don't change cached reads; no invalidation needed.
  }
}
