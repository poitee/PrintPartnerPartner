import type { ReviewPart } from "../../api/engine";
import PartThumb from "../parts/PartThumb";
import { Button } from "../ui/button";
import { cn } from "../../lib/utils";

type Props = {
  part: ReviewPart;
  busy: boolean;
  onQtyChange: (part: ReviewPart, qty: number) => void;
  onRemove: () => void;
  onRestore: () => void;
};

function MobileQtyStepper({
  part,
  disabled,
  onChange,
}: {
  part: ReviewPart;
  disabled?: boolean;
  onChange: (qty: number) => void;
}) {
  const qty = part.quantity_override ?? part.quantity_effective;
  return (
    <div className="qty-control flex items-center gap-1">
      <button
        type="button"
        className="qty-btn rounded-md border min-h-10 min-w-10"
        disabled={disabled || qty <= 1}
        onClick={() => onChange(qty - 1)}
        aria-label={`Decrease quantity for ${part.filename}`}
      >
        −
      </button>
      <span className="qty-display min-w-[2.5ch] text-center text-base font-semibold tabular-nums">
        {qty}
      </span>
      <button
        type="button"
        className="qty-btn rounded-md border min-h-10 min-w-10"
        disabled={disabled}
        onClick={() => onChange(qty + 1)}
        aria-label={`Increase quantity for ${part.filename}`}
      >
        +
      </button>
    </div>
  );
}

export default function ReviewSheetMobileCard({
  part,
  busy,
  onQtyChange,
  onRemove,
  onRestore,
}: Props) {
  return (
    <article className={cn("checkoff-mobile-card", !part.included && "opacity-80")}>
      <div className="checkoff-mobile-card-head">
        <PartThumb partId={part.id} tintHex={part.filament_hex} sizePx={72} />
        <div className="checkoff-mobile-card-meta">
          <h4 className="checkoff-mobile-filename" title={part.relative_path || part.filename}>
            {part.filename}
          </h4>
          <p className="checkoff-mobile-sub">
            {part.filament_display && <span>{part.filament_display}</span>}
            {part.role && <span className="checkoff-mobile-role">{part.role}</span>}
            {!part.included && <span className="checkoff-mobile-role">excluded</span>}
          </p>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
        {part.included ? (
          <>
            <MobileQtyStepper
              part={part}
              disabled={busy}
              onChange={(n) => onQtyChange(part, n)}
            />
            <Button
              type="button"
              variant="sheetRemove"
              size="sm"
              className="sheet-remove-btn"
              disabled={busy}
              onClick={onRemove}
            >
              Remove
            </Button>
          </>
        ) : (
          <Button
            type="button"
            variant="sheetRestore"
            className="sheet-restore-btn w-full"
            disabled={busy}
            onClick={onRestore}
          >
            Restore to build
          </Button>
        )}
      </div>
    </article>
  );
}
