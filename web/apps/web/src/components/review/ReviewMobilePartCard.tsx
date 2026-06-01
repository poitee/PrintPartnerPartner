import type { PartRow } from "../../api/engine";
import { sourceLabelFromLayer } from "../../lib/reviewParts";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { cn } from "../../lib/utils";
import Preview3D from "../Preview3D";

function QuantityStepper({
  part,
  disabled,
  onChange,
}: {
  part: PartRow;
  disabled?: boolean;
  onChange: (qty: number) => void;
}) {
  const qty = part.quantity_override ?? part.quantity_effective;
  return (
    <div className="qty-control">
      <button
        type="button"
        className="qty-btn rounded-md border border-input bg-background"
        disabled={disabled || qty <= 1}
        onClick={() => onChange(qty - 1)}
        aria-label={`Decrease quantity for ${part.filename}`}
      >
        −
      </button>
      <input
        type="number"
        className="qty-input rounded-md border border-input bg-background w-14 text-center text-base"
        min={1}
        value={qty}
        disabled={disabled}
        onChange={(e) => {
          const n = Number(e.target.value);
          if (Number.isFinite(n)) onChange(n);
        }}
        aria-label={`Quantity for ${part.filename}`}
      />
      <button
        type="button"
        className="qty-btn rounded-md border border-input bg-background"
        disabled={disabled}
        onClick={() => onChange(qty + 1)}
        aria-label={`Increase quantity for ${part.filename}`}
      >
        +
      </button>
    </div>
  );
}

type Props = {
  part: PartRow;
  selected: boolean;
  disabled?: boolean;
  busy?: boolean;
  onSelect: () => void;
  onQtyChange: (qty: number) => void;
  onRemove: () => void;
};

export default function ReviewMobilePartCard({
  part,
  selected,
  disabled,
  busy,
  onSelect,
  onQtyChange,
  onRemove,
}: Props) {
  return (
    <article
      className={cn(
        "review-mobile-card rounded-lg border border-border bg-background p-3",
        selected && "border-primary/50 bg-primary/5 ring-1 ring-primary/30",
      )}
    >
      <button
        type="button"
        className="w-full text-left"
        onClick={onSelect}
      >
        <p className="font-medium leading-snug break-words">{part.filename}</p>
        <p className="mt-1 text-xs text-muted-foreground">
          {sourceLabelFromLayer(part.source_layer)}
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Badge variant={part.role === "accent" ? "muted" : "default"}>
            {part.role || "primary"}
          </Badge>
          {part.filament_display && (
            <span className="text-xs text-muted-foreground">{part.filament_display}</span>
          )}
        </div>
      </button>

      {selected && (
        <div className="mt-3 border-t border-border pt-3">
          <Preview3D
            key={`${part.id}-${part.filament_hex ?? "unset"}`}
            partId={part.id}
            filename={part.filename}
            meshColor={part.filament_hex ?? undefined}
            className="min-h-[180px] rounded-md"
          />
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
        <QuantityStepper
          part={part}
          disabled={disabled || busy}
          onChange={onQtyChange}
        />
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="min-h-10"
          disabled={disabled || busy}
          onClick={onRemove}
        >
          Remove
        </Button>
      </div>
    </article>
  );
}
