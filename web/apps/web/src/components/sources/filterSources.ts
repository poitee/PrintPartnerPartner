import type { SourceSummary } from "../../api/engine";
import type { SyncFilter } from "./SourcesToolbar";
import { UNCategorized_FILTER } from "./sourceLabels";

export function filterSources(
  sources: SourceSummary[],
  opts: {
    search: string;
    categoryFilter: string;
    syncFilter: SyncFilter;
    platformFilter: string;
  },
): SourceSummary[] {
  const needle = opts.search.trim().toLowerCase();
  return sources.filter((s) => {
    if (needle) {
      const hay = `${s.name} ${s.url}`.toLowerCase();
      if (!hay.includes(needle)) return false;
    }
    if (opts.categoryFilter === UNCategorized_FILTER) {
      if (s.category) return false;
    } else if (opts.categoryFilter !== "all") {
      if ((s.category ?? "") !== opts.categoryFilter) return false;
    }
    if (opts.syncFilter === "synced" && !s.last_synced_at) return false;
    if (opts.syncFilter === "unsynced" && s.last_synced_at) return false;
    if (opts.platformFilter !== "all" && s.source_kind !== opts.platformFilter) {
      return false;
    }
    return true;
  });
}
