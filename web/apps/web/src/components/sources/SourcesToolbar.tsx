import { LayoutGrid, List, Tags } from "lucide-react";
import type { SourceSummary } from "../../api/engine";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select";
import { kindLabel } from "./sourceLabels";
import { UNCategorized_FILTER } from "./sourceLabels";

export type SourceViewMode = "grid" | "list";
export type SyncFilter = "all" | "synced" | "unsynced";

type Props = {
  search: string;
  onSearchChange: (value: string) => void;
  categoryFilter: string;
  onCategoryFilterChange: (value: string) => void;
  categories: string[];
  syncFilter: SyncFilter;
  onSyncFilterChange: (value: SyncFilter) => void;
  platformFilter: string;
  onPlatformFilterChange: (value: string) => void;
  sources: SourceSummary[];
  viewMode: SourceViewMode;
  onViewModeChange: (mode: SourceViewMode) => void;
  onManageCategories?: () => void;
};

export default function SourcesToolbar({
  search,
  onSearchChange,
  categoryFilter,
  onCategoryFilterChange,
  categories,
  syncFilter,
  onSyncFilterChange,
  platformFilter,
  onPlatformFilterChange,
  sources,
  viewMode,
  onViewModeChange,
  onManageCategories,
}: Props) {
  const platforms = Array.from(
    new Set(sources.map((s) => s.source_kind).filter(Boolean)),
  ).sort();

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-card p-3">
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-[12rem] flex-1">
          <Label htmlFor="source-search" className="text-xs text-muted-foreground">
            Search sources
          </Label>
          <Input
            id="source-search"
            placeholder="Name or URL…"
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
          />
        </div>
        <div className="w-40">
          <Label className="text-xs text-muted-foreground">Category</Label>
          <Select value={categoryFilter} onValueChange={onCategoryFilterChange}>
            <SelectTrigger>
              <SelectValue placeholder="All" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All categories</SelectItem>
              <SelectItem value={UNCategorized_FILTER}>Uncategorized</SelectItem>
              {categories.map((c) => (
                <SelectItem key={c} value={c}>
                  {c}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="w-36">
          <Label className="text-xs text-muted-foreground">Sync</Label>
          <Select
            value={syncFilter}
            onValueChange={(v) => onSyncFilterChange(v as SyncFilter)}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="synced">Synced</SelectItem>
              <SelectItem value="unsynced">Not synced</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="w-40">
          <Label className="text-xs text-muted-foreground">Platform</Label>
          <Select value={platformFilter} onValueChange={onPlatformFilterChange}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All platforms</SelectItem>
              {platforms.map((k) => (
                <SelectItem key={k} value={k}>
                  {kindLabel(k)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex gap-1 self-end">
          {onManageCategories && (
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={onManageCategories}
            >
              <Tags className="mr-1.5 h-4 w-4" />
              Manage categories
            </Button>
          )}
          <Button
            type="button"
            size="sm"
            variant={viewMode === "grid" ? "secondary" : "ghost"}
            aria-label="Grid view"
            onClick={() => onViewModeChange("grid")}
          >
            <LayoutGrid className="h-4 w-4" />
          </Button>
          <Button
            type="button"
            size="sm"
            variant={viewMode === "list" ? "secondary" : "ghost"}
            aria-label="List view"
            onClick={() => onViewModeChange("list")}
          >
            <List className="h-4 w-4" />
          </Button>
        </div>
      </div>
      <div className="flex flex-wrap gap-1.5">
        <Button
          type="button"
          size="sm"
          variant={categoryFilter === "all" ? "secondary" : "ghost"}
          onClick={() => onCategoryFilterChange("all")}
        >
          All
        </Button>
        <Button
          type="button"
          size="sm"
          variant={categoryFilter === UNCategorized_FILTER ? "secondary" : "ghost"}
          onClick={() => onCategoryFilterChange(UNCategorized_FILTER)}
        >
          Uncategorized
        </Button>
        {categories.map((c) => (
          <Button
            key={c}
            type="button"
            size="sm"
            variant={categoryFilter === c ? "secondary" : "ghost"}
            onClick={() => onCategoryFilterChange(c)}
          >
            {c}
          </Button>
        ))}
      </div>
    </div>
  );
}
