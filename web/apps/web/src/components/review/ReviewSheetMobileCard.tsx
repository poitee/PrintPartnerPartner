import { Check } from "lucide-react";
import type { ReviewPart } from "../../api/engine";
import type { ReviewViewMode } from "../../lib/persistedReviewPartsUi";
import PartThumb from "../parts/PartThumb";
import { Button } from "../ui/button";
import { cn } from "../../lib/utils";

type Props = {
  part: ReviewPart;
  viewMode: ReviewViewMode;
  busy: boolean;
  onToggleUnit: (part: ReviewPart, unitIndex: number) => void;
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
        className="qty-btn rounded-md border border-input bg-background min-h-10 min-w-10"
        disabled={disabled || qty <= 1}
        onClick={() => onChange(qty - 1)}
      >
        −
      </button>
      <span className="min-w-[2ch] text-center font-medium">{qty}</span>
      <button
        type="button"
        className="qty-btn rounded-md border border-input bg-background min-h-10 min-w-10"
        disabled={disabled}
        onClick={() => onChange(qty + 1)}
      >
        +
      </button>
    </div>
  );
}

export default function ReviewSheetMobileCard({
  part,
  viewMode,
  busy,
  onToggleUnit,
  onQtyChange,
  onRemove,
  onRestore,
}: Props) {
  const done =
    part.printed_count >= part.quantity_effective && part.quantity_effective > 0;
  const nextIdx = part.print_units.findIndex((u) => !u);
  const edit = viewMode === "edit";

  return (
    <article
      className={cn(
        "checkoff-mobile-card",
        done && !edit && "checkoff-mobile-card-done",
        !part.included && "opacity-80",
      )}
    >
      <div className="checkoff-mobile-card-head">
        <PartThumb partId={part.id} tintHex={part.filament_hex} sizePx={72} />
        <div className="checkoff-mobile-card-meta">
          <h4 className="checkoff-mobile-filename" title={part.relative_path || part.filename}>
            {part.filename}
          </h4>
          <p className="checkoff-mobile-sub">
            {part.filament_display && <span>{part.filament_display}</span>}
            {part.role && <span className="checkoff-mobile-role">{part.role}</span>}
            <span className="checkoff-mobile-qty">
              {part.printed_count}/{part.quantity_effective} printed
            </span>
          </p>
        </div>
      </div>

      {edit ? (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
          {part.included ? (
            <>
              <MobileQtyStepper
                part={part}
                disabled={busy}
                onChange={(n) => onQtyChange(part, n)}
              />
              <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={onRemove}>
                Remove
              </Button>
            </>
          ) : (
            <Button type="button" variant="secondary" className="w-full" disabled={busy} onClick={onRestore}>
              Restore to build
            </Button>
          )}
        </div>
      ) : (
        <>
          {part.quantity_effective > 0 && part.included && (
            <div className="checkoff-mobile-actions">
              <Button
                type="button"
                className="checkoff-mobile-mark-btn h-12 w-full text-base"
                disabled={busy || nextIdx < 0}
                onClick={() => nextIdx >= 0 && onToggleUnit(part, nextIdx)}
              >
                <Check className="mr-2 h-5 w-5 shrink-0" aria-hidden />
                {nextIdx < 0 ? "All units printed" : `Mark unit ${nextIdx + 1} done`}
              </Button>
            </div>
          )}
          <div className="checkoff-mobile-units" role="group" aria-label="Print units">
            {part.print_units.map((unitDone, idx) => (
              <label
                key={idx}
                className={cn("checkoff-mobile-unit", unitDone && "checkoff-mobile-unit-done")}
              >
                <input
                  type="checkbox"
                  checked={unitDone}
                  onChange={() => onToggleUnit(part, idx)}
                  disabled={busy || !part.included}
                />
                <span>#{idx + 1}</span>
              </label>
            ))}
          </div>
        </>
      )}
    </article>
  );
}
