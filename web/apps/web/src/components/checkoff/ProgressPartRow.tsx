import type { DraggableAttributes, DraggableSyntheticListeners } from "@dnd-kit/core";
import { Minus, Plus } from "lucide-react";
import type { ReviewPart } from "../../api/engine";
import {
  lastCompletedUnit,
  nextUnitToComplete,
  partProgressPercent,
  partProgressTone,
} from "../../lib/checkoffProgress";
import { folderKeyFromRelativePath } from "../../lib/checkoffGroups";
import { sourceLabelFromLayer } from "../../lib/reviewParts";
import { cn } from "../../lib/utils";
import { SortableDragHandle } from "../dnd/SortableDragHandle";
import PartThumbExpandButton from "../parts/PartThumbExpandButton";
import { Button } from "../ui/button";

type Props = {
  part: ReviewPart;
  busy: boolean;
  /** Dense phone layout: larger steppers, no inline bar. */
  compact?: boolean;
  onIncrement: (part: ReviewPart) => void;
  onDecrement: (part: ReviewPart) => void;
  onPreview: (part: ReviewPart) => void;
  /** When set, shows a grip handle for Progress list reorder. */
  dragHandle?: {
    attributes: DraggableAttributes;
    listeners: DraggableSyntheticListeners;
    disabled?: boolean;
  };
};

function sourceLine(part: ReviewPart): string {
  const repo = sourceLabelFromLayer(part.source_layer);
  const folder = folderKeyFromRelativePath(part.relative_path);
  if (!folder || folder === "(root)") return repo;
  return `${repo} / ${folder}`;
}

const toneCountClass: Record<ReturnType<typeof partProgressTone>, string> = {
  empty: "text-destructive",
  partial: "text-warning",
  done: "text-success",
};

const toneBarClass: Record<ReturnType<typeof partProgressTone>, string> = {
  empty: "bg-muted",
  partial: "bg-warning",
  done: "bg-success",
};

/**
 * Screen Progress row — thumb, path, filament swatch, bar, −/+ steppers
 * (matches Workflow mock Progress / phone checkoff density).
 */
export default function ProgressPartRow({
  part,
  busy,
  compact = false,
  onIncrement,
  onDecrement,
  onPreview,
  dragHandle,
}: Props) {
  const qty = part.quantity_effective;
  const tone = partProgressTone(part.printed_count, qty);
  const pct = partProgressPercent(part.printed_count, qty);
  const canInc = nextUnitToComplete(part.print_units) >= 0;
  const canDec = lastCompletedUnit(part.print_units) >= 0;
  const countLabel = `${part.printed_count} of ${qty}`;

  const handle = dragHandle ? (
    <SortableDragHandle
      attributes={dragHandle.attributes}
      listeners={dragHandle.listeners}
      disabled={dragHandle.disabled || busy}
      label={`Reorder ${part.filename}`}
      className={compact ? "size-10" : "size-7"}
    />
  ) : null;

  if (compact) {
    return (
      <article
        className={cn(
          "flex items-center gap-3 rounded-[10px] border border-border bg-card p-3 shadow-sm",
          tone === "done" && "border-success/40 bg-success/5",
        )}
      >
        {handle}
        <PartThumbExpandButton part={part} sizePx={52} onExpand={onPreview} />
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <span
            className="truncate font-mono text-xs"
            title={part.relative_path || part.filename}
          >
            {part.filename}
          </span>
          <div className="flex items-center gap-2">
            {part.filament_hex ? (
              <span
                className="size-2.5 shrink-0 rounded-sm border border-black/15"
                style={{ background: part.filament_hex }}
                title={part.filament_display || undefined}
              />
            ) : null}
            <span className={cn("font-mono text-xs font-medium tabular-nums", toneCountClass[tone])}>
              {countLabel}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="size-11 rounded-[10px]"
            disabled={busy || !canDec}
            aria-label={`Decrease printed count for ${part.filename}`}
            onClick={() => onDecrement(part)}
          >
            <Minus className="size-5" />
          </Button>
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="size-11 rounded-[10px] border-primary bg-primary/10 text-primary hover:bg-primary/15 hover:text-primary"
            disabled={busy || !canInc}
            aria-label={`Increase printed count for ${part.filename}`}
            onClick={() => onIncrement(part)}
          >
            <Plus className="size-5" />
          </Button>
        </div>
      </article>
    );
  }

  return (
    <article
      className={cn(
        "flex items-center gap-3 rounded-lg border border-border bg-card px-3 py-2.5 shadow-sm",
        tone === "done" && "border-success/40 bg-success/5",
      )}
    >
      {handle}
      <PartThumbExpandButton part={part} sizePx={40} onExpand={onPreview} />
      <div className="flex w-[min(100%,20rem)] min-w-0 flex-col gap-0.5">
        <span
          className="truncate font-mono text-xs"
          title={part.relative_path || part.filename}
        >
          {part.filename}
        </span>
        <span className="truncate text-[11px] text-muted-foreground">{sourceLine(part)}</span>
      </div>
      {part.filament_hex ? (
        <span
          className="size-3.5 shrink-0 rounded border border-black/15"
          style={{ background: part.filament_hex }}
          title={part.filament_display || undefined}
        />
      ) : (
        <span className="size-3.5 shrink-0" aria-hidden />
      )}
      <span
        className="hidden h-1.5 max-w-[14rem] flex-1 overflow-hidden rounded-full bg-muted sm:block"
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`${part.filename} ${pct}% printed`}
      >
        <span
          className={cn("block h-full rounded-full transition-[width]", toneBarClass[tone])}
          style={{ width: `${pct}%` }}
        />
      </span>
      <div className="ml-auto flex items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="size-7 rounded-md"
          disabled={busy || !canDec}
          aria-label={`Decrease printed count for ${part.filename}`}
          onClick={() => onDecrement(part)}
        >
          <Minus className="size-3.5" />
        </Button>
        <span
          className={cn(
            "w-[3.25rem] text-center font-mono text-[13px] font-medium tabular-nums",
            toneCountClass[tone],
          )}
        >
          {countLabel}
        </span>
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="size-7 rounded-md border-primary bg-primary/10 text-primary hover:bg-primary/15 hover:text-primary"
          disabled={busy || !canInc}
          aria-label={`Increase printed count for ${part.filename}`}
          onClick={() => onIncrement(part)}
        >
          <Plus className="size-3.5" />
        </Button>
      </div>
    </article>
  );
}
