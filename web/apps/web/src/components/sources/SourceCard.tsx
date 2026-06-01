import { MoreHorizontal } from "lucide-react";
import {
  formatSyncTime,
  shortSha,
  type SourceSummary,
} from "../../api/engine";
import SourceCardCover from "../SourceCardCover";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Card, CardContent } from "../ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import { cn } from "../../lib/utils";
import { kindLabel } from "./sourceLabels";

type Props = {
  source: SourceSummary;
  viewMode: "grid" | "list";
  busy: boolean;
  onOpen: (source: SourceSummary) => void;
  onEdit: (source: SourceSummary) => void;
  onSync: (source: SourceSummary) => void;
  onDelete: (source: SourceSummary) => void;
};

export default function SourceCard({
  source,
  viewMode,
  busy,
  onOpen,
  onEdit,
  onSync,
  onDelete,
}: Props) {
  const synced = Boolean(source.last_synced_at);

  return (
    <Card
      className={cn(
        "overflow-hidden shadow-none transition-colors hover:border-primary/30",
        viewMode === "list" && "flex flex-row",
      )}
    >
      <SourceCardCover
        sourceId={source.id}
        name={source.name}
        sourceKind={source.source_kind}
        compact={viewMode === "list"}
        className={viewMode === "list" ? "w-28 shrink-0" : undefined}
      />
      <CardContent
        className={cn("flex flex-1 flex-col gap-2 p-4", viewMode === "list" && "py-3")}
      >
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h3 className="truncate font-semibold text-foreground">{source.name}</h3>
            <p className="text-xs text-muted-foreground">{kindLabel(source.source_kind)}</p>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button type="button" variant="ghost" size="sm" className="h-8 w-8 p-0">
                <MoreHorizontal className="h-4 w-4" />
                <span className="sr-only">Actions</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => onOpen(source)}>Open</DropdownMenuItem>
              <DropdownMenuItem onClick={() => onEdit(source)}>Edit</DropdownMenuItem>
              {source.source_kind === "github" && (
                <DropdownMenuItem disabled={busy} onClick={() => onSync(source)}>
                  Sync
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="text-destructive focus:text-destructive"
                onClick={() => onDelete(source)}
              >
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <div className="flex flex-wrap gap-1">
          {source.category ? (
            <Badge variant="default">{source.category}</Badge>
          ) : (
            <Badge variant="muted">Uncategorized</Badge>
          )}
          <Badge variant="muted">{synced ? formatSyncTime(source.last_synced_at) : "Not synced"}</Badge>
          {source.last_commit_sha && (
            <Badge variant="muted">{shortSha(source.last_commit_sha)}</Badge>
          )}
        </div>
        <div className="mt-auto flex flex-wrap gap-1">
          <Button size="sm" onClick={() => onOpen(source)}>
            Open
          </Button>
          {source.source_kind === "github" && (
            <Button size="sm" variant="secondary" disabled={busy} onClick={() => onSync(source)}>
              Sync
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
