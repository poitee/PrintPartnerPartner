import type { PlanReview, ReviewPart } from "../api/engine";
import { folderKeyFromRelativePath } from "./checkoffGroups";
import { isPartFullyPrinted } from "./checkoffProgress";
import type {
  ReviewIncludedFilter,
  ReviewPrintFilter,
  ReviewSortKey,
} from "./persistedReviewPartsUi";
import { sourceLabelFromLayer } from "./reviewParts";

export type ReviewPartsFilterState = {
  search: string;
  printFilter: ReviewPrintFilter;
  includedFilter: ReviewIncludedFilter;
  sourceLayer: string | null;
  folder: string | null;
  role: string | null;
  filament: string | null;
  issuesOnly: boolean;
  sort: ReviewSortKey;
};

function partPrintStatus(part: ReviewPart): ReviewPrintFilter {
  const qty = Math.max(1, part.quantity_effective);
  if (part.printed_count >= qty) return "complete";
  if (part.printed_count <= 0) return "missing";
  return "partial";
}

export function filterReviewParts(
  parts: ReviewPart[],
  review: PlanReview | null,
  state: ReviewPartsFilterState,
): ReviewPart[] {
  let rows = parts;

  if (state.includedFilter === "included") {
    rows = rows.filter((p) => p.included);
  } else if (state.includedFilter === "excluded") {
    rows = rows.filter((p) => !p.included);
  }

  if (state.printFilter !== "all") {
    rows = rows.filter((p) => partPrintStatus(p) === state.printFilter);
  }

  if (state.sourceLayer) {
    rows = rows.filter((p) => p.source_layer === state.sourceLayer);
  }

  if (state.folder) {
    rows = rows.filter(
      (p) => folderKeyFromRelativePath(p.relative_path || p.filename) === state.folder,
    );
  }

  if (state.role) {
    rows = rows.filter((p) => (p.role || "primary") === state.role);
  }

  if (state.filament) {
    rows = rows.filter((p) => (p.filament_display || "") === state.filament);
  }

  if (state.issuesOnly && review) {
    const issueFiles = new Set(
      review.issues
        .filter((i) => i.code === "missing_stl" || i.code === "merge_conflict")
        .map((i) => {
          const m = i.message.match(/:\s*(.+)$/);
          return m?.[1]?.trim();
        })
        .filter(Boolean) as string[],
    );
    if (issueFiles.size > 0) {
      rows = rows.filter((p) => issueFiles.has(p.filename));
    }
  }

  const q = state.search.trim().toLowerCase();
  if (q) {
    rows = rows.filter((p) => {
      const hay = [
        p.filename,
        p.relative_path,
        p.role ?? "",
        p.filament_display ?? "",
        sourceLabelFromLayer(p.source_layer),
      ]
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }

  return sortReviewParts(rows, state.sort);
}

export function sortReviewParts(parts: ReviewPart[], sort: ReviewSortKey): ReviewPart[] {
  const byFilename = (a: ReviewPart, b: ReviewPart) =>
    a.filename.localeCompare(b.filename, undefined, { sensitivity: "base", numeric: true });

  if (sort === "filename") {
    return [...parts].sort(byFilename);
  }
  if (sort === "qty") {
    return [...parts].sort(
      (a, b) => b.quantity_effective - a.quantity_effective || byFilename(a, b),
    );
  }

  return [...parts].sort((a, b) => {
    const repoCmp = (a.source_layer || "").localeCompare(b.source_layer || "");
    if (repoCmp !== 0) return repoCmp;
    const folderCmp = folderKeyFromRelativePath(a.relative_path || a.filename).localeCompare(
      folderKeyFromRelativePath(b.relative_path || b.filename),
    );
    return folderCmp !== 0 ? folderCmp : byFilename(a, b);
  });
}

export function collectReviewFacets(parts: ReviewPart[]) {
  const folders = new Set<string>();
  const roles = new Set<string>();
  const filaments = new Set<string>();
  const sourceLayers = new Set<string>();
  for (const p of parts) {
    folders.add(folderKeyFromRelativePath(p.relative_path || p.filename));
    roles.add(p.role || "primary");
    if (p.filament_display) filaments.add(p.filament_display);
    if (p.source_layer) sourceLayers.add(p.source_layer);
  }
  return {
    folders: [...folders].sort(),
    roles: [...roles].sort(),
    filaments: [...filaments].sort(),
    sourceLayers: [...sourceLayers].sort(),
  };
}

export function isReviewPartComplete(part: ReviewPart): boolean {
  return isPartFullyPrinted(part);
}
